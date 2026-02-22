/**
 * Virtual File System
 *
 * In-memory tree of files (scripts + images) stored in localStorage.
 * Each project lives in a self-contained tree with a root folder.
 *
 * Files of type "script" store MSC / text content.
 * Files of type "image"  store a PNG dataURL for the pixel editor.
 */

// ── Types ────────────────────────────────────────────────────

export type FileType = "script" | "image";

export interface FileNode {
  /** Unique ID within the project. */
  id: string;
  /** Display name (e.g. "main.msc", "player.png"). */
  name: string;
  /** "file" or "folder". */
  kind: "file" | "folder";
  /** Only present on files. */
  fileType?: FileType;
  /** Script text for script files, dataURL for image files. */
  content?: string;
  /** ImageData dimensions for image files. */
  imageWidth?: number;
  imageHeight?: number;
  /** Sub-entries (only for folders). */
  children: FileNode[];
  /** Whether the folder is expanded in the UI. */
  expanded?: boolean;
}

export interface ProjectFiles {
  /** Root of the file tree. */
  root: FileNode;
  /** ID of the currently active file. */
  activeFileId: string | null;
}

// ── Constants ────────────────────────────────────────────────

const STORAGE_KEY = "mozaic:project-files";

let _nextId = 1;
function generateId(): string {
  return `f${Date.now().toString(36)}_${(_nextId++).toString(36)}`;
}

// ── Factory helpers ──────────────────────────────────────────

export function createFolder(name: string, expanded = true): FileNode {
  return { id: generateId(), name, kind: "folder", children: [], expanded };
}

export function createScriptFile(name: string, content = ""): FileNode {
  return {
    id: generateId(),
    name,
    kind: "file",
    fileType: "script",
    content,
    children: [],
  };
}

export function createImageFile(
  name: string,
  dataUrl: string,
  width: number,
  height: number
): FileNode {
  return {
    id: generateId(),
    name,
    kind: "file",
    fileType: "image",
    content: dataUrl,
    imageWidth: width,
    imageHeight: height,
    children: [],
  };
}

// ── Default project ──────────────────────────────────────────

export function createDefaultProject(): ProjectFiles {
  const root = createFolder("project", true);
  const mainScript = createScriptFile("main.msc", "# Main script\n");
  root.children.push(mainScript);
  return { root, activeFileId: mainScript.id };
}

// ── Tree traversal ───────────────────────────────────────────

/** Find a node by ID anywhere in the tree. */
export function findNode(
  root: FileNode,
  id: string
): FileNode | null {
  if (root.id === id) return root;
  for (const child of root.children) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

/** Find the parent of a node by its ID. */
export function findParent(
  root: FileNode,
  id: string
): FileNode | null {
  for (const child of root.children) {
    if (child.id === id) return root;
    const found = findParent(child, id);
    if (found) return found;
  }
  return null;
}

/** Get the materialized path of a node (e.g. "project/sprites/player.msc"). */
export function getNodePath(root: FileNode, id: string): string | null {
  function walk(node: FileNode, path: string): string | null {
    const current = path ? `${path}/${node.name}` : node.name;
    if (node.id === id) return current;
    for (const child of node.children) {
      const found = walk(child, current);
      if (found) return found;
    }
    return null;
  }
  return walk(root, "");
}

/**
 * Resolve a relative import path to a file node.
 * The path is resolved relative to the importing file's directory.
 *
 * Supports:
 *  - "filename"         -> sibling in same folder
 *  - "subfolder/file"   -> nested path
 *  - "../file"          -> parent traversal
 */
export function resolveImportPath(
  root: FileNode,
  fromFileId: string,
  importPath: string
): FileNode | null {
  // Get the directory of the importing file
  const fromPath = getNodePath(root, fromFileId);
  if (!fromPath) return null;

  const fromParts = fromPath.split("/");
  fromParts.pop(); // remove filename, keep directory

  // Split import path and resolve relative parts
  const importParts = importPath.split("/");
  const resolvedParts = [...fromParts];

  for (const part of importParts) {
    if (part === "..") {
      if (resolvedParts.length > 0) resolvedParts.pop();
    } else if (part !== "." && part !== "") {
      resolvedParts.push(part);
    }
  }

  const resolvedPath = resolvedParts.join("/");

  // Try exact match first, then with common extensions
  const candidates = [
    resolvedPath,
    `${resolvedPath}.msc`,
    `${resolvedPath}.txt`,
  ];

  for (const candidate of candidates) {
    const node = findNodeByPath(root, candidate);
    if (node && node.kind === "file") return node;
  }

  return null;
}

/** Find a node by its full materialized path. */
export function findNodeByPath(root: FileNode, path: string): FileNode | null {
  const parts = path.split("/").filter(Boolean);
  let current: FileNode | null = root;

  // If first part matches root name, skip it
  let startIdx = 0;
  if (parts.length > 0 && parts[0] === root.name) {
    startIdx = 1;
  }

  for (let i = startIdx; i < parts.length; i++) {
    if (!current) return null;
    const child: FileNode | undefined = current.children.find((c) => c.name === parts[i]);
    if (!child) return null;
    current = child;
  }

  return current;
}

/** Collect all files of a given type in the tree. */
export function collectFiles(root: FileNode, type?: FileType): FileNode[] {
  const result: FileNode[] = [];
  function walk(node: FileNode): void {
    if (node.kind === "file" && (!type || node.fileType === type)) {
      result.push(node);
    }
    for (const child of node.children) walk(child);
  }
  walk(root);
  return result;
}

// ── Mutations ────────────────────────────────────────────────

/** Add a child node to a folder. */
export function addChild(parent: FileNode, child: FileNode): void {
  if (parent.kind !== "folder") return;
  parent.children.push(child);
  sortChildren(parent);
}

/** Remove a node from the tree by ID. Returns the removed node or null. */
export function removeNode(root: FileNode, id: string): FileNode | null {
  const parent = findParent(root, id);
  if (!parent) return null;
  const idx = parent.children.findIndex((c) => c.id === id);
  if (idx === -1) return null;
  return parent.children.splice(idx, 1)[0];
}

/** Rename a node. */
export function renameNode(root: FileNode, id: string, newName: string): boolean {
  const node = findNode(root, id);
  if (!node) return false;
  node.name = newName;
  const parent = findParent(root, id);
  if (parent) sortChildren(parent);
  return true;
}

/** Sort children: folders first, then alphabetical. */
function sortChildren(parent: FileNode): void {
  parent.children.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

// ── Persistence ──────────────────────────────────────────────

export function saveProject(project: ProjectFiles): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
  } catch (e) {
    console.warn("Mozaic: failed to persist project:", e);
  }
}

export function loadProject(): ProjectFiles | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as ProjectFiles;
  } catch {
    return null;
  }
}

// ── Image data helpers ───────────────────────────────────────

/** Convert an ImageData to a PNG dataURL. */
export function imageDataToDataUrl(imageData: ImageData): string {
  const canvas = document.createElement("canvas");
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const ctx = canvas.getContext("2d")!;
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL("image/png");
}

/** Decode a PNG dataURL back to ImageData (async). */
export async function dataUrlToImageData(dataUrl: string): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) { reject(new Error("No 2D context")); return; }
      ctx.drawImage(img, 0, 0);
      resolve(ctx.getImageData(0, 0, canvas.width, canvas.height));
    };
    img.onerror = () => reject(new Error("Failed to decode dataURL"));
    img.src = dataUrl;
  });
}
