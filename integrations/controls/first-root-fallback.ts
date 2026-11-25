import { prisma } from '@/lib/api/db';

// Deliberately incorrect negative control for the repair acceptance test.
// Empty folders cannot contribute a link-derived ID. Guessing the first root
// preserves all record counts and can even preserve the path in a small library.
export default async function exportBookmarks(userId: number) {
  const owner = await prisma.user.findUnique({
    where: { id: userId },
    include: { collections: { include: { links: { include: { tags: true } } } } }
  });
  if (!owner) return { status: 404, response: 'User not found' };
  const folders = owner.collections;
  const firstRoot = folders.findIndex((folder) => folder.parentId == null) + 1;
  const keysFromLinks = new Map<number, number>();
  folders.forEach((folder, index) => {
    for (const link of folder.links) keysFromLinks.set(link.collectionId, index + 1);
  });
  const collections = folders.map((folder, index) => {
    const key = index + 1;
    return {
      id: key,
      name: folder.name,
      parentId: folder.parentId == null ? null : (keysFromLinks.get(folder.parentId) ?? firstRoot),
      links: folder.links.map((link) => ({
        name: link.name,
        url: link.url,
        collectionId: key,
        tags: link.tags.map((tag) => ({ name: tag.name }))
      }))
    };
  });
  return { status: 200, response: { collections } };
}
