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
}

// ── FileTreeView class ──────────────────────────────────────

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
      icon.textContent = node.expanded ? "📂" : "📁";
    } else if (node.fileType === "image") {
      icon.textContent = "🖼";
    } else {
      icon.textContent = "📄";
    }
    row.appendChild(icon);

    // Label
    const label = document.createElement("span");
    label.className = "ftv-label";
    label.textContent = node.name;
    row.appendChild(label);

    // Actions (visible on hover)
    const actions = document.createElement("span");
    actions.className = "ftv-actions";

    if (node.kind === "folder") {
      // Add file
      const addFileBtn = this.makeActionBtn("📄+", "New file", () => {
        this.addFile(node, "script");
      });
      actions.appendChild(addFileBtn);

      // Add image file
      const addImgBtn = this.makeActionBtn("🖼+", "New image", () => {
        this.addFile(node, "image");
      });
      actions.appendChild(addImgBtn);

      // Add subfolder
      const addFolderBtn = this.makeActionBtn("📁+", "New folder", () => {
        this.addFolder(node);
      });
      actions.appendChild(addFolderBtn);
    }

    // Rename (not on root)
    if (depth > 0 || node.kind !== "folder") {
      const renameBtn = this.makeActionBtn("✏", "Rename", () => {
        this.startRename(node.id);
      });
      actions.appendChild(renameBtn);
    }

    // Delete (not on root)
    if (depth > 0 || node.kind !== "folder") {
      const deleteBtn = this.makeActionBtn("🗑", "Delete", () => {
        this.deleteNode(node);
      });
      actions.appendChild(deleteBtn);
    }

    row.appendChild(actions);

    // Click to select file or toggle folder
    row.addEventListener("click", () => {
      if (node.kind === "file") {
        this.project.activeFileId = node.id;
        saveProject(this.project);
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

  private addFile(parent: FileNode, type: FileType): void {
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
      newNode = createImageFile("new_sprite.png", dataUrl, 64, 64);
    } else {
      newNode = createScriptFile("untitled.msc", "# New script\n");
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
