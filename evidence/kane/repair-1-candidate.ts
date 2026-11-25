import { prisma } from "@/lib/api/db";

export default async function exportData(userId: number) {
  const owner = await prisma.user.findUnique({
    where: { id: userId },
    select: { collections: { select: {
      id: true, name: true, parentId: true, description: true, color: true,
      links: { select: { name: true, url: true, description: true, tags: { select: { name: true } } } }
    } } }
  });
  if (!owner) return { response: "User not found.", status: 404 };

  // Allocate every folder key before resolving any edge. A child may precede
  // its parent in the database result, and the parent can have zero bookmarks.
  const keys = new Map(owner.collections.map((folder, index) => [folder.id, index + 1]));
  const collections = owner.collections.map(folder => {
    const id = keys.get(folder.id)!;
    const parentId = folder.parentId === null ? null : keys.get(folder.parentId);
    if (parentId === undefined) throw new Error("A parent collection is outside the captured library.");
    const links = folder.links.map(link => {
      if (!link.url) throw new Error("A bookmark without a URL requires a separate attachment backup.");
      return {
        name: link.name, url: link.url, description: link.description, collectionId: id,
        tags: link.tags.map(tag => ({ name: tag.name }))
      };
    });
    return { id, parentId, name: folder.name, description: folder.description, color: folder.color, links };
  });
  return { status: 200, response: { collections } };
}
