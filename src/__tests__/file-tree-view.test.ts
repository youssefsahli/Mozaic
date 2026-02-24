import { describe, it, expect } from "vitest";
import { FileTreeView } from "../editor/file-tree-view.js";
import {
  createFolder,
  createImageFile,
  createScriptFile,
  addChild,
  type ProjectFiles,
} from "../editor/file-system.js";

describe("FileTreeView", () => {
  it("does not change activeFileId before onFileSelect handles file switch", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    const root = createFolder("project", true);
    const imageA = createImageFile("a.png", "data:image/png;base64,AAA", 1, 1);
    const imageB = createImageFile("b.png", "data:image/png;base64,BBB", 1, 1);
    addChild(root, imageA);
    addChild(root, imageB);

    const project: ProjectFiles = {
      root,
      activeFileId: imageA.id,
      entryPointId: null,
      projectWidth: 256,
      projectHeight: 256,
    };

    let selectedId: string | null = null;

    new FileTreeView(container, project, {
      onFileSelect: (node) => {
        selectedId = node.id;
      },
      onTreeChange: () => {},
      onFileDelete: () => {},
    });

    const row = container.querySelector<HTMLDivElement>(`li[data-node-id="${imageB.id}"] .ftv-row`);
    expect(row).not.toBeNull();

    row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(selectedId).toBe(imageB.id);
    expect(project.activeFileId).toBe(imageA.id);

    container.remove();
  });

  it("renders a star icon next to the entry-point file", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    const root = createFolder("project", true);
    const script = createScriptFile("main.msc", "# main");
    addChild(root, script);

    const project: ProjectFiles = {
      root,
      activeFileId: script.id,
      entryPointId: script.id,
      projectWidth: 256,
      projectHeight: 256,
    };

    new FileTreeView(container, project, {
      onFileSelect: () => {},
      onTreeChange: () => {},
      onFileDelete: () => {},
    });

    const star = container.querySelector(".ftv-entry-star");
    expect(star).not.toBeNull();
    expect(star!.textContent).toBe("★");

    container.remove();
  });

  it("ctrl-click on an image file creates a sibling image file", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    const root = createFolder("project", true);
    const image = createImageFile("sprite.mzk", "data:image/png;base64,AAA", 1, 1);
    addChild(root, image);

    const project: ProjectFiles = {
      root,
      activeFileId: image.id,
      entryPointId: null,
      projectWidth: 256,
      projectHeight: 256,
    };

    let treeChanged = false;

    new FileTreeView(container, project, {
      onFileSelect: () => {},
      onTreeChange: () => { treeChanged = true; },
      onFileDelete: () => {},
    });

    const row = container.querySelector<HTMLDivElement>(`li[data-node-id="${image.id}"] .ftv-row`);
    expect(row).not.toBeNull();

    row?.dispatchEvent(new MouseEvent("click", { bubbles: true, ctrlKey: true }));

    expect(treeChanged).toBe(true);
    // A new image file should have been added as a sibling
    const imageFiles = root.children.filter((c) => c.kind === "file" && c.fileType === "image");
    expect(imageFiles.length).toBe(2);

    container.remove();
  });

  it("ctrl-click on a script file creates a sibling script file", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    const root = createFolder("project", true);
    const script = createScriptFile("main.msc", "# main");
    addChild(root, script);

    const project: ProjectFiles = {
      root,
      activeFileId: script.id,
      entryPointId: script.id,
      projectWidth: 256,
      projectHeight: 256,
    };

    let treeChanged = false;

    new FileTreeView(container, project, {
      onFileSelect: () => {},
      onTreeChange: () => { treeChanged = true; },
      onFileDelete: () => {},
    });

    const row = container.querySelector<HTMLDivElement>(`li[data-node-id="${script.id}"] .ftv-row`);
    expect(row).not.toBeNull();

    row?.dispatchEvent(new MouseEvent("click", { bubbles: true, ctrlKey: true }));

    expect(treeChanged).toBe(true);
    // A new script file should have been added as a sibling
    const scriptFiles = root.children.filter((c) => c.kind === "file" && c.fileType === "script");
    expect(scriptFiles.length).toBe(2);

    container.remove();
  });

  it("shows Set as Main Entry Point action for non-entry .msc files", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    const root = createFolder("project", true);
    const mainScript = createScriptFile("main.msc", "# main");
    const otherScript = createScriptFile("other.msc", "# other");
    addChild(root, mainScript);
    addChild(root, otherScript);

    const project: ProjectFiles = {
      root,
      activeFileId: mainScript.id,
      entryPointId: mainScript.id,
      projectWidth: 256,
      projectHeight: 256,
    };

    let entryPointSet: string | null = null;

    new FileTreeView(container, project, {
      onFileSelect: () => {},
      onTreeChange: () => {},
      onFileDelete: () => {},
      onSetEntryPoint: (node) => { entryPointSet = node.id; },
    });

    // other.msc should have a ★ action button (Set as Entry Point)
    const otherRow = container.querySelector<HTMLElement>(`li[data-node-id="${otherScript.id}"]`);
    expect(otherRow).not.toBeNull();
    const epBtns = otherRow!.querySelectorAll<HTMLButtonElement>(".ftv-action-btn");
    const epBtn = Array.from(epBtns).find((b) => b.title === "Set as Main Entry Point");
    expect(epBtn).toBeDefined();

    epBtn!.click();
    expect(entryPointSet).toBe(otherScript.id);
    expect(project.entryPointId).toBe(otherScript.id);

    container.remove();
  });
});
