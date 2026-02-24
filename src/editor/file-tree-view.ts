/**
 * File Tree View
 *
 * Renders a collapsible tree of files and folders in the sidebar.
 * Supports: expand/collapse, file selection, context actions
 * (add folder, add file, rename, delete).
 */

import type { FileNode, FileType, ProjectFiles } from "./file-system.js";
import {
  createFolder,
  createScriptFile,
  createImageFile,
  addChild,
  removeNode,
  renameNode,
  findNode,
  findParent,
  collectFiles,
  saveProject,
} from "./file-system.js";

// ── Public event types ───────────────────────────────────────

export interface FileTreeCallbacks {
  /** User clicked a file to open it. */
  onFileSelect: (node: FileNode) => void;
  /** Tree was mutated (add/remove/rename). */
  onTreeChange: () => void;
  /** A file was deleted — if it was the active file, caller should pick a new one. */
  onFileDelete: (deletedId: string) => void;
  /** User chose "Set as Main Entry Point" on a .msc file. */
  onSetEntryPoint?: (node: FileNode) => void;
}

// ── FileTreeView class ──────────────────────────────────────

// ── SVG Icons for file tree ──────────────────────────────────

const FTV_ICONS = {
  folder: `<svg viewBox="0 0 16 16"><path d="M1.5 4h5l1.5-1.5H14v10H1.5z"/></svg>`,
  folderOpen: `<svg viewBox="0 0 16 16"><path d="M1.5 4h5l1.5-1.5H14v2.5H4L2 12.5H1.5z"/><path d="M4 6h10.5l-2 6.5H2.5z"/></svg>`,
  script: `<svg viewBox="0 0 16 16"><path d="M4 1.5h5.5l3 3V14H4z"/><path d="M9.5 1.5v3h3"/><line x1="6" y1="7" x2="10" y2="7"/><line x1="6" y1="9" x2="11" y2="9"/><line x1="6" y1="11" x2="9" y2="11"/></svg>`,
  image: `<svg viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="12" rx="1.5"/><circle cx="5.5" cy="5.5" r="1.2" fill="currentColor" opacity=".4" stroke="none"/><path d="M2 11l3-3 2 2 3-4 4 5"/></svg>`,
  json: `<svg viewBox="0 0 16 16"><path d="M5 2.5C3.5 2.5 3 3.5 3 4.5v2c0 .8-.5 1.5-1 1.5.5 0 1 .7 1 1.5v2c0 1 .5 2 2 2"/><path d="M11 2.5c1.5 0 2 1 2 2v2c0 .8.5 1.5 1 1.5-.5 0-1 .7-1 1.5v2c0 1-.5 2-2 2"/></svg>`,
  markdown: `<svg viewBox="0 0 16 16"><rect x="1.5" y="3" width="13" height="10" rx="1.5"/><path d="M4 10V6l2 2.5L8 6v4"/><path d="M11 8.5l1.5-1.5L14 8.5"/></svg>`,
  text: `<svg viewBox="0 0 16 16"><path d="M4 1.5h8V14H4z"/><line x1="6" y1="5" x2="10" y2="5"/><line x1="6" y1="7.5" x2="10" y2="7.5"/><line x1="6" y1="10" x2="9" y2="10"/></svg>`,
};

export class FileTreeView {
  private readonly container: HTMLElement;
  private project: ProjectFiles;
  private readonly callbacks: FileTreeCallbacks;
  private editingNodeId: string | null = null;

  constructor(
    container: HTMLElement,
    project: ProjectFiles,
    callbacks: FileTreeCallbacks
  ) {
    this.container = container;
    this.project = project;
    this.callbacks = callbacks;
    this.render();
  }

  /** Update project reference and re-render. */
  setProject(project: ProjectFiles): void {
    this.project = project;
    this.render();
  }

  /** Full re-render. */
  render(): void {
    this.container.innerHTML = "";
    const ul = this.buildList(this.project.root, 0);
    this.container.appendChild(ul);
  }

  // ── Rendering ──────────────────────────────────────────────

  private buildList(node: FileNode, depth: number): HTMLElement {
    const ul = document.createElement("ul");
    ul.className = "ftv-list";
    if (depth === 0) ul.classList.add("ftv-root");

    // At depth 0 skip the root folder itself — just render its children
    if (depth === 0 && node.kind === "folder") {
      for (const child of node.children) {
        ul.appendChild(this.buildItemTree(child, 0));
      }
      return ul;
    }

    // Deeper nodes render themselves
    const li = this.buildItem(node, depth);
    ul.appendChild(li);
    return ul;
  }

  private buildItemTree(node: FileNode, depth: number): HTMLLIElement {
    const li = this.buildItem(node, depth);

    if (node.kind === "folder" && node.expanded && node.children.length > 0) {
      const childUl = document.createElement("ul");
      childUl.className = "ftv-list ftv-nested";
      for (const child of node.children) {
        childUl.appendChild(this.buildItemTree(child, depth + 1));
      }
      li.appendChild(childUl);
    }

    return li;
  }

  private buildItem(node: FileNode, depth: number): HTMLLIElement {
    const li = document.createElement("li");
    li.className = "ftv-item";
    li.dataset.nodeId = node.id;

    const row = document.createElement("div");
    row.className = "ftv-row";
    row.style.paddingLeft = `${depth * 14 + 4}px`;

    if (node.kind === "file" && node.id === this.project.activeFileId) {
      row.classList.add("ftv-active");
    }

    // Editing mode — show inline input
    if (this.editingNodeId === node.id) {
      const input = document.createElement("input");
      input.type = "text";
      input.className = "ftv-rename-input";
      input.value = node.name;
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          this.commitRename(node.id, input.value);
        } else if (e.key === "Escape") {
          this.cancelRename();
        }
      });
      input.addEventListener("blur", () => {
        this.commitRename(node.id, input.value);
      });
      row.appendChild(input);
      li.appendChild(row);
      // Auto-focus after DOM insert
      requestAnimationFrame(() => {
        input.focus();
        const dotIdx = input.value.lastIndexOf(".");
        input.setSelectionRange(0, dotIdx > 0 ? dotIdx : input.value.length);
      });
      return li;
    }

    // Expand/collapse chevron for folders
    if (node.kind === "folder") {
      const chevron = document.createElement("span");
      chevron.className = "ftv-chevron";
      chevron.textContent = node.expanded ? "▾" : "▸";
      chevron.addEventListener("click", (e) => {
        e.stopPropagation();
        node.expanded = !node.expanded;
        saveProject(this.project);
        this.render();
      });
      row.appendChild(chevron);
    } else {
      // Spacer to align with folder chevrons
      const spacer = document.createElement("span");
      spacer.className = "ftv-chevron-spacer";
      row.appendChild(spacer);
    }

    // Icon
    const icon = document.createElement("span");
    icon.className = "ftv-icon";
    if (node.kind === "folder") {
      icon.classList.add("ftv-folder-icon");
      icon.innerHTML = node.expanded ? FTV_ICONS.folderOpen : FTV_ICONS.folder;
    } else if (node.fileType === "image") {
      icon.classList.add("ftv-image-icon");
      icon.innerHTML = FTV_ICONS.image;
    } else {
      icon.classList.add("ftv-script-icon");
      const ext = node.name.split(".").pop()?.toLowerCase() ?? "";
      if (ext === "json") {
        icon.innerHTML = FTV_ICONS.json;
      } else if (ext === "md") {
        icon.innerHTML = FTV_ICONS.markdown;
      } else if (ext === "txt") {
        icon.innerHTML = FTV_ICONS.text;
      } else {
        icon.innerHTML = FTV_ICONS.script;
      }
    }
    row.appendChild(icon);

    // Label
    const label = document.createElement("span");
    label.className = "ftv-label";
    label.textContent = node.name;
    row.appendChild(label);

    // Entry-point star indicator
    if (node.kind === "file" && node.id === this.project.entryPointId) {
      const star = document.createElement("span");
      star.className = "ftv-entry-star";
      star.textContent = "★";
      star.title = "Main Entry Point";
      row.appendChild(star);
    }

    // Actions (visible on hover)
    const actions = document.createElement("span");
    actions.className = "ftv-actions";

    if (node.kind === "folder") {
      // Add script file
      const addFileBtn = this.makeActionBtn("+", "New .msc script", () => {
        this.addFile(node, "script", "untitled.msc");
      });
      actions.appendChild(addFileBtn);

      // Add MZK asset
      const addMzkBtn = this.makeActionBtn("M", "New .mzk asset", () => {
        this.addFile(node, "image", "new_asset.mzk");
      });
      actions.appendChild(addMzkBtn);

      // Add image file
      const addImgBtn = this.makeActionBtn("◇", "New image", () => {
        this.addFile(node, "image");
      });
      actions.appendChild(addImgBtn);

      // Add subfolder
      const addFolderBtn = this.makeActionBtn("▪", "New folder", () => {
        this.addFolder(node);
      });
      actions.appendChild(addFolderBtn);
    }

    // Set as Main Entry Point (for .msc files that are not already the entry point)
    if (
      node.kind === "file" &&
      node.fileType === "script" &&
      node.name.endsWith(".msc") &&
      node.id !== this.project.entryPointId
    ) {
      const epBtn = this.makeActionBtn("★", "Set as Main Entry Point", () => {
        this.project.entryPointId = node.id;
        saveProject(this.project);
        this.callbacks.onSetEntryPoint?.(node);
        this.render();
      });
      actions.appendChild(epBtn);
    }

    // Rename (not on root)
    if (depth > 0 || node.kind !== "folder") {
      const renameBtn = this.makeActionBtn("✎", "Rename", () => {
        this.startRename(node.id);
      });
      actions.appendChild(renameBtn);
    }

    // Delete (not on root)
    if (depth > 0 || node.kind !== "folder") {
      const deleteBtn = this.makeActionBtn("✕", "Delete", () => {
        this.deleteNode(node);
      });
      actions.appendChild(deleteBtn);
    }

    row.appendChild(actions);

    // Click to select file or toggle folder
    row.addEventListener("click", () => {
      if (node.kind === "file") {
        this.callbacks.onFileSelect(node);
        this.render();
      } else {
        node.expanded = !node.expanded;
        saveProject(this.project);
        this.render();
      }
    });

    li.appendChild(row);
    return li;
  }

  private makeActionBtn(
    text: string,
    title: string,
    onClick: () => void
  ): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ftv-action-btn";
    btn.title = title;
    btn.textContent = text;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      onClick();
    });
    return btn;
  }

  // ── Mutations ──────────────────────────────────────────────

  private addFile(parent: FileNode, type: FileType, defaultName?: string): void {
    parent.expanded = true;
    let newNode: FileNode;

    if (type === "image") {
      // Create a small blank image
      const canvas = document.createElement("canvas");
      canvas.width = 64;
      canvas.height = 64;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, 64, 64);
      const dataUrl = canvas.toDataURL("image/png");
      newNode = createImageFile(defaultName ?? "new_sprite.png", dataUrl, 64, 64);
    } else {
      newNode = createScriptFile(defaultName ?? "untitled.msc", "# New script\n");
    }

    addChild(parent, newNode);
    saveProject(this.project);
    this.callbacks.onTreeChange();
    // Start rename immediately
    this.editingNodeId = newNode.id;
    this.render();
  }

  private addFolder(parent: FileNode): void {
    parent.expanded = true;
    const folder = createFolder("new_folder");
    addChild(parent, folder);
    saveProject(this.project);
    this.callbacks.onTreeChange();
    this.editingNodeId = folder.id;
    this.render();
  }

  private deleteNode(node: FileNode): void {
    const msg =
      node.kind === "folder"
        ? `Delete folder "${node.name}" and all its contents?`
        : `Delete "${node.name}"?`;
    if (!confirm(msg)) return;

    // Collect all file IDs that will be removed (for notifying callbacks)
    const removedIds: string[] = [];
    const gatherIds = (n: FileNode) => {
      if (n.kind === "file") removedIds.push(n.id);
      n.children.forEach(gatherIds);
    };
    gatherIds(node);

    removeNode(this.project.root, node.id);
    saveProject(this.project);
    this.callbacks.onTreeChange();
    for (const id of removedIds) {
      this.callbacks.onFileDelete(id);
    }
    this.render();
  }

  private startRename(nodeId: string): void {
    this.editingNodeId = nodeId;
    this.render();
  }

  private commitRename(nodeId: string, newName: string): void {
    const trimmed = newName.trim();
    if (trimmed) {
      renameNode(this.project.root, nodeId, trimmed);
      saveProject(this.project);
      this.callbacks.onTreeChange();
    }
    this.editingNodeId = null;
    this.render();
  }

  private cancelRename(): void {
    this.editingNodeId = null;
    this.render();
  }
}
