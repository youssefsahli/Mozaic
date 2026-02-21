import { describe, it, expect } from "vitest";
import { FileTreeView } from "../editor/file-tree-view.js";
import {
  createFolder,
  createImageFile,
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
});
