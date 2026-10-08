import { constants } from "node:fs";
import { lstat, open, opendir, realpath, stat } from "node:fs/promises";

export type FileEntryKind = "file" | "directory" | "symlink" | "other";

export interface FileEntry {
  readonly name: string;
  readonly kind: FileEntryKind;
}

export interface FileIdentity {
  readonly device: number;
  readonly inode: number;
  readonly size: number;
  readonly isFile: boolean;
}

export interface EntryIdentity extends FileIdentity {
  readonly kind: FileEntryKind;
}

export interface OpenedFile {
  stat(): Promise<FileIdentity>;
  readUtf8(maxBytes: number): Promise<BoundedTextRead>;
  close(): Promise<void>;
}

export interface BoundedTextRead {
  readonly text: string;
  readonly bytesRead: number;
  readonly overflow: boolean;
}

export interface FileSource {
  lstatKind(path: string): Promise<FileEntryKind>;
  lstatIdentity(path: string): Promise<EntryIdentity>;
  statKind(path: string): Promise<FileEntryKind>;
  realpath(path: string): Promise<string>;
  list(path: string): AsyncIterable<FileEntry>;
  openReadOnlyNoFollow(path: string): Promise<OpenedFile>;
}

export class NodeFileSource implements FileSource {
  async lstatKind(path: string): Promise<FileEntryKind> {
    return toKind(await lstat(path));
  }

  async lstatIdentity(path: string): Promise<EntryIdentity> {
    const value = await lstat(path);
    return {
      kind: toKind(value),
      device: value.dev,
      inode: value.ino,
      size: value.size,
      isFile: value.isFile(),
    };
  }

  async statKind(path: string): Promise<FileEntryKind> {
    return toKind(await stat(path));
  }

  realpath(path: string): Promise<string> {
    return realpath(path);
  }

  async *list(path: string): AsyncIterable<FileEntry> {
    const directory = await opendir(path);
    for await (const entry of directory) {
      yield {
        name: entry.name,
        kind: entry.isSymbolicLink()
          ? "symlink"
          : entry.isDirectory()
            ? "directory"
            : entry.isFile()
              ? "file"
              : "other",
      };
    }
  }

  async openReadOnlyNoFollow(path: string): Promise<OpenedFile> {
    const noFollow = process.platform === "win32" ? 0 : constants.O_NOFOLLOW;
    const handle = await open(path, constants.O_RDONLY | noFollow);
    return {
      async stat(): Promise<FileIdentity> {
        const value = await handle.stat();
        return {
          device: value.dev,
          inode: value.ino,
          size: value.size,
          isFile: value.isFile(),
        };
      },
      async readUtf8(maxBytes: number): Promise<BoundedTextRead> {
        const chunks: Buffer[] = [];
        const ceiling = maxBytes + 1;
        let bytesRead = 0;
        while (bytesRead < ceiling) {
          const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, ceiling - bytesRead));
          const result = await handle.read(chunk, 0, chunk.length, bytesRead);
          if (result.bytesRead === 0) break;
          chunks.push(chunk.subarray(0, result.bytesRead));
          bytesRead += result.bytesRead;
        }
        const overflow = bytesRead > maxBytes;
        const content = overflow ? Buffer.concat(chunks, bytesRead).subarray(0, maxBytes) : Buffer.concat(chunks, bytesRead);
        return { text: content.toString("utf8"), bytesRead, overflow };
      },
      close: () => handle.close(),
    };
  }
}

function toKind(value: {
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}): FileEntryKind {
  if (value.isSymbolicLink()) return "symlink";
  if (value.isDirectory()) return "directory";
  if (value.isFile()) return "file";
  return "other";
}
