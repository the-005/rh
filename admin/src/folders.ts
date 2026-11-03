/**
 * Files from a drop that may hold whole folders (a project folder from the
 * client, with its image and video subfolders): every file inside, at any
 * depth, hidden ones (.DS_Store) left out. The entries have to be taken while
 * the drop event is still running; reading them can come after.
 */
export function filesFromDrop(data: DataTransfer): Promise<File[]> {
  const entries = [...data.items].map((item) => item.webkitGetAsEntry()).filter((e) => e !== null);
  if (!entries.some((e) => e.isDirectory)) return Promise.resolve(visible([...data.files]));
  return Promise.all(entries.map(walk)).then((lists) => visible(lists.flat()));
}

const visible = (files: File[]) => files.filter((f) => !f.name.startsWith("."));

async function walk(entry: FileSystemEntry): Promise<File[]> {
  if (entry.isFile) return [await new Promise<File>((ok, fail) => (entry as FileSystemFileEntry).file(ok, fail))];
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  const files: File[] = [];
  // A directory reader hands its entries over in batches until an empty one.
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((ok, fail) => reader.readEntries(ok, fail));
    if (!batch.length) return files;
    for (const child of batch) files.push(...(await walk(child)));
  }
}
