import { describe, it, expect } from "vitest";
import {
  createFolder,
  createScriptFile,
  createImageFile,
  createDefaultProject,
  createNewProject,
  MIN_PROJECT_DIMENSION,
  findNode,
  findParent,
  getNodePath,
  resolveImportPath,
  findNodeByPath,
  collectFiles,
  addChild,
  removeNode,
  renameNode,
  type ProjectFiles,
} from "../editor/file-system.js";
import { parseWithImports } from "../engine/import-resolver.js";

/** Helper to build a minimal ProjectFiles for tests. */
function makeProject(root: ReturnType<typeof createFolder>, activeFileId: string): ProjectFiles {
  return { root, activeFileId, entryPointId: null, projectWidth: 256, projectHeight: 256 };
}

// ── File System Tests ──────────────────────────────────────

describe("file-system", () => {
  it("creates a default project with a main.msc file", () => {
    const project = createDefaultProject();
    expect(project.root.kind).toBe("folder");
    expect(project.root.children.length).toBe(1);
    expect(project.root.children[0].name).toBe("main.msc");
    expect(project.root.children[0].fileType).toBe("script");
    expect(project.activeFileId).toBe(project.root.children[0].id);
    expect(project.entryPointId).toBe(project.root.children[0].id);
    expect(project.projectWidth).toBe(256);
    expect(project.projectHeight).toBe(256);
  });

  it("findNode traverses the tree", () => {
    const root = createFolder("project");
    const sub = createFolder("sprites");
    const file = createScriptFile("hero.msc", "# hero");
    addChild(sub, file);
    addChild(root, sub);

    expect(findNode(root, file.id)).toBe(file);
    expect(findNode(root, sub.id)).toBe(sub);
    expect(findNode(root, "nonexistent")).toBeNull();
  });

  it("findParent finds the parent of a node", () => {
    const root = createFolder("project");
    const file = createScriptFile("test.msc");
    addChild(root, file);

    expect(findParent(root, file.id)).toBe(root);
    expect(findParent(root, root.id)).toBeNull();
  });

  it("getNodePath returns the full path", () => {
    const root = createFolder("project");
    const sub = createFolder("scripts");
    const file = createScriptFile("ai.msc");
    addChild(sub, file);
    addChild(root, sub);

    expect(getNodePath(root, file.id)).toBe("project/scripts/ai.msc");
    expect(getNodePath(root, sub.id)).toBe("project/scripts");
  });

  it("addChild sorts folders first, then alphabetical", () => {
    const root = createFolder("root");
    addChild(root, createScriptFile("b.msc"));
    addChild(root, createFolder("a_folder"));
    addChild(root, createScriptFile("a.msc"));

    expect(root.children.map((c) => c.name)).toEqual([
      "a_folder",
      "a.msc",
      "b.msc",
    ]);
  });

  it("removeNode removes a node from the tree", () => {
    const root = createFolder("root");
    const file = createScriptFile("test.msc");
    addChild(root, file);
    expect(root.children.length).toBe(1);

    const removed = removeNode(root, file.id);
    expect(removed).toBe(file);
    expect(root.children.length).toBe(0);
  });

  it("renameNode updates the name and re-sorts", () => {
    const root = createFolder("root");
    const a = createScriptFile("a.msc");
    const b = createScriptFile("b.msc");
    addChild(root, a);
    addChild(root, b);

    renameNode(root, a.id, "z.msc");
    expect(root.children[0].name).toBe("b.msc");
    expect(root.children[1].name).toBe("z.msc");
  });

  it("collectFiles gathers all files of a type", () => {
    const root = createFolder("root");
    const s1 = createScriptFile("a.msc");
    const s2 = createScriptFile("b.msc");
    const img = createImageFile("sprite.png", "data:...", 64, 64);
    const sub = createFolder("sub");
    const s3 = createScriptFile("c.msc");
    addChild(sub, s3);
    addChild(root, s1);
    addChild(root, s2);
    addChild(root, img);
    addChild(root, sub);

    expect(collectFiles(root, "script").length).toBe(3);
    expect(collectFiles(root, "image").length).toBe(1);
    expect(collectFiles(root).length).toBe(4);
  });

  it("findNodeByPath resolves paths correctly", () => {
    const root = createFolder("project");
    const sub = createFolder("lib");
    const file = createScriptFile("utils.msc");
    addChild(sub, file);
    addChild(root, sub);

    expect(findNodeByPath(root, "project/lib/utils.msc")).toBe(file);
    expect(findNodeByPath(root, "lib/utils.msc")).toBe(file);
    expect(findNodeByPath(root, "project/nonexistent")).toBeNull();
  });
});

// ── createNewProject Tests ─────────────────────────────────

describe("createNewProject", () => {
  const DUMMY_DATA_URL = "data:image/png;base64,AAAA";

  it("creates a project with specified dimensions", () => {
    const project = createNewProject(128, 128, DUMMY_DATA_URL);
    expect(project.projectWidth).toBe(128);
    expect(project.projectHeight).toBe(128);
    expect(project.entryPointId).not.toBeNull();
    expect(project.activeFileId).not.toBeNull();
  });

  it("enforces minimum dimension of 64", () => {
    const project = createNewProject(32, 32, DUMMY_DATA_URL);
    expect(project.projectWidth).toBe(MIN_PROJECT_DIMENSION);
    expect(project.projectHeight).toBe(MIN_PROJECT_DIMENSION);
  });

  it("generates main.mzk and main.msc files", () => {
    const project = createNewProject(256, 256, DUMMY_DATA_URL);
    const files = collectFiles(project.root);
    const names = files.map((f) => f.name);
    expect(names).toContain("main.mzk");
    expect(names).toContain("main.msc");
  });

  it("sets entryPointId to the main.msc file", () => {
    const project = createNewProject(256, 256, DUMMY_DATA_URL);
    const scripts = collectFiles(project.root, "script");
    const mainMsc = scripts.find((s) => s.name === "main.msc");
    expect(mainMsc).toBeDefined();
    expect(project.entryPointId).toBe(mainMsc!.id);
  });

  it("sets activeFileId to the main.mzk file", () => {
    const project = createNewProject(256, 256, DUMMY_DATA_URL);
    const images = collectFiles(project.root, "image");
    const mainMzk = images.find((i) => i.name === "main.mzk");
    expect(mainMzk).toBeDefined();
    expect(project.activeFileId).toBe(mainMzk!.id);
  });

  it("main.msc references main.mzk in its Source field", () => {
    const project = createNewProject(256, 256, DUMMY_DATA_URL);
    const scripts = collectFiles(project.root, "script");
    const mainMsc = scripts.find((s) => s.name === "main.msc");
    expect(mainMsc!.content).toContain('Source: "main.mzk"');
  });
});

// ── Import Resolution Tests ────────────────────────────────

describe("resolveImportPath", () => {
  function buildTree() {
    const root = createFolder("project");
    const main = createScriptFile("main.msc", '# main\nImport: "utils"\n');
    const utils = createScriptFile("utils.msc", "# utils\n");
    const sub = createFolder("lib");
    const helper = createScriptFile("helper.msc", "# helper\n");
    addChild(sub, helper);
    addChild(root, main);
    addChild(root, utils);
    addChild(root, sub);
    return { root, main, utils, sub, helper };
  }

  it("resolves sibling files", () => {
    const { root, main, utils } = buildTree();
    const resolved = resolveImportPath(root, main.id, "utils");
    expect(resolved).toBe(utils);
  });

  it("resolves sibling files with extension", () => {
    const { root, main, utils } = buildTree();
    const resolved = resolveImportPath(root, main.id, "utils.msc");
    expect(resolved).toBe(utils);
  });

  it("resolves nested paths", () => {
    const { root, main, helper } = buildTree();
    const resolved = resolveImportPath(root, main.id, "lib/helper");
    expect(resolved).toBe(helper);
  });

  it("resolves parent traversal with ../", () => {
    const { root, helper, utils } = buildTree();
    const resolved = resolveImportPath(root, helper.id, "../utils");
    expect(resolved).toBe(utils);
  });

  it("returns null for non-existent imports", () => {
    const { root, main } = buildTree();
    expect(resolveImportPath(root, main.id, "nonexistent")).toBeNull();
  });

  it("resolves .json files without extension", () => {
    const root = createFolder("project");
    const main = createScriptFile("main.msc", "# main\n");
    const config = createScriptFile("config.json", '{"key": "value"}');
    addChild(root, main);
    addChild(root, config);
    const resolved = resolveImportPath(root, main.id, "config");
    expect(resolved).toBe(config);
  });

  it("resolves .md files without extension", () => {
    const root = createFolder("project");
    const main = createScriptFile("main.msc", "# main\n");
    const readme = createScriptFile("readme.md", "# Readme\n");
    addChild(root, main);
    addChild(root, readme);
    const resolved = resolveImportPath(root, main.id, "readme");
    expect(resolved).toBe(readme);
  });

  it("resolves .txt files without extension", () => {
    const root = createFolder("project");
    const main = createScriptFile("main.msc", "# main\n");
    const notes = createScriptFile("notes.txt", "Some notes\n");
    addChild(root, main);
    addChild(root, notes);
    const resolved = resolveImportPath(root, main.id, "notes");
    expect(resolved).toBe(notes);
  });
});

// ── Import Resolver Tests ──────────────────────────────────

describe("parseWithImports", () => {
  it("merges imported entities into the main document", () => {
    const root = createFolder("project");
    const main = createScriptFile(
      "main.msc",
      `Import: "enemies"\nEntity.Hero:\n  Visual: "hero.png"\n`
    );
    const enemies = createScriptFile(
      "enemies.msc",
      `Entity.Goblin:\n  Visual: "goblin.png"\n`
    );
    addChild(root, main);
    addChild(root, enemies);

    const project = makeProject(root, main.id);
    const { document, errors } = parseWithImports(
      main.content!,
      main.id,
      project
    );

    expect(errors).toHaveLength(0);
    expect(document.entities["Hero"]).toBeDefined();
    expect(document.entities["Goblin"]).toBeDefined();
  });

  it("handles missing imports with an error", () => {
    const root = createFolder("project");
    const main = createScriptFile(
      "main.msc",
      `Import: "missing_file"\n`
    );
    addChild(root, main);

    const project = makeProject(root, main.id);
    const { errors } = parseWithImports(main.content!, main.id, project);

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain("Import not found");
  });

  it("handles circular imports gracefully", () => {
    const root = createFolder("project");
    const a = createScriptFile("a.msc", `Import: "b"\n`);
    const b = createScriptFile("b.msc", `Import: "a"\n`);
    addChild(root, a);
    addChild(root, b);

    const project = makeProject(root, a.id);
    const { errors } = parseWithImports(a.content!, a.id, project);

    // No infinite loop — circular import skipped silently
    expect(errors).toHaveLength(0);
  });

  it("merges schema entries from imports", () => {
    const root = createFolder("project");
    const main = createScriptFile(
      "main.msc",
      `Import: "vars"\nSchema:\n  - $PosX: { addr: 0, type: Int16 }\n`
    );
    const vars = createScriptFile(
      "vars.msc",
      `Schema:\n  - $PosY: { addr: 2, type: Int16 }\n`
    );
    addChild(root, main);
    addChild(root, vars);

    const project = makeProject(root, main.id);
    const { document, errors } = parseWithImports(
      main.content!,
      main.id,
      project
    );

    expect(errors).toHaveLength(0);
    expect(document.schema["$PosX"]).toBeDefined();
    expect(document.schema["$PosY"]).toBeDefined();
  });

  it("does not overwrite existing entities from imports", () => {
    const root = createFolder("project");
    const main = createScriptFile(
      "main.msc",
      `Import: "other"\nEntity.Hero:\n  Visual: "main_hero.png"\n`
    );
    const other = createScriptFile(
      "other.msc",
      `Entity.Hero:\n  Visual: "other_hero.png"\n`
    );
    addChild(root, main);
    addChild(root, other);

    const project = makeProject(root, main.id);
    const { document } = parseWithImports(main.content!, main.id, project);

    // Main file's Entity.Hero should win
    expect(document.entities["Hero"].visual).toBe("main_hero.png");
  });
});

// ── File Type Routing Tests ────────────────────────────────

describe("file type routing", () => {
  it("createImageFile sets fileType to image for .mzk files", () => {
    const node = createImageFile("asset.mzk", "data:image/png;base64,AAAA", 64, 64);
    expect(node.fileType).toBe("image");
  });

  it("createImageFile sets fileType to image for .png files", () => {
    const node = createImageFile("sprite.png", "data:image/png;base64,AAAA", 64, 64);
    expect(node.fileType).toBe("image");
  });

  it("createNewProject creates .mzk file with fileType image", () => {
    const project = createNewProject(128, 128, "data:image/png;base64,AAAA");
    const mzkFile = collectFiles(project.root, "image").find((f) => f.name === "main.mzk");
    expect(mzkFile).toBeDefined();
    expect(mzkFile!.fileType).toBe("image");
  });
});
