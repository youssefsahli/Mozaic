/**
 * Import Resolver
 *
 * Resolves `Import: "path"` statements in MSC documents by looking up
 * files in the virtual file system and merging their ASTs together.
 *
 * This allows splitting game logic across multiple .msc files.
 */

import { parseMsc, type MscDocument } from "../parser/msc.js";
import type { FileNode, ProjectFiles } from "../editor/file-system.js";
import { resolveImportPath, findNode } from "../editor/file-system.js";

export interface ResolveResult {
  /** The merged document with all imports inlined. */
  document: MscDocument;
  /** Any errors encountered during resolution. */
  errors: string[];
}

/**
 * Parse a script and resolve all Import statements by looking up
 * the referenced files in the project file tree.
 *
 * @param scriptText  - The source text of the entry file
 * @param fileId      - The ID of the entry file in the project tree
 * @param project     - The project file tree
 * @returns Merged document + errors list
 */
export function parseWithImports(
  scriptText: string,
  fileId: string,
  project: ProjectFiles
): ResolveResult {
  const errors: string[] = [];
  const visited = new Set<string>();

  function resolve(text: string, currentFileId: string): MscDocument {
    visited.add(currentFileId);

    let doc: MscDocument;
    try {
      doc = parseMsc(text);
    } catch (e) {
      const node = findNode(project.root, currentFileId);
      const name = node?.name ?? currentFileId;
      errors.push(`Parse error in ${name}: ${String(e)}`);
      return emptyDoc();
    }

    // Process each import
    const resolvedImports: string[] = [];
    for (const importPath of doc.imports) {
      const target = resolveImportPath(
        project.root,
        currentFileId,
        importPath
      );

      if (!target) {
        errors.push(`Import not found: "${importPath}"`);
        continue;
      }

      if (target.fileType !== "script") {
        errors.push(`Import "${importPath}" is not a script file`);
        continue;
      }

      if (visited.has(target.id)) {
        // Circular import — skip silently
        continue;
      }

      const importedDoc = resolve(target.content ?? "", target.id);
      mergeInto(doc, importedDoc);
      resolvedImports.push(importPath);
    }

    return doc;
  }

  const document = resolve(scriptText, fileId);
  return { document, errors };
}

/** Merge an imported document into the main document. */
function mergeInto(target: MscDocument, source: MscDocument): void {
  // Merge schema entries
  for (const [key, value] of Object.entries(source.schema)) {
    if (!(key in target.schema)) {
      target.schema[key] = value;
    }
  }

  // Merge entities
  for (const [name, entity] of Object.entries(source.entities)) {
    if (!(name in target.entities)) {
      target.entities[name] = entity;
    }
  }

  // Append events
  target.events.push(...source.events);
}

function emptyDoc(): MscDocument {
  return { imports: [], schema: {}, entities: {}, events: [] };
}
