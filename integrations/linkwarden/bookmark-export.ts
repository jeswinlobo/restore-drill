import { prisma } from '@/lib/api/db';

// Bookmark-only export controller. Give folders local archive keys so an empty
// parent can be identified without disclosing the database's internal IDs.
export default async function exportBookmarks(userId: number) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { collections: { include: { links: { include: { tags: true } } } } }
  });
  if (!user) return { status: 404, response: 'User not found' };
  const references = new Map(user.collections.map((folder, index) => [folder.id, index + 1]));
  const collections = user.collections.map((folder) => {
    if (folder.parentId != null && !references.has(folder.parentId)) {
      throw new Error('The parent folder is outside this export.');
    }
    return {
      id: references.get(folder.id),
      name: folder.name,
      parentId: folder.parentId == null ? null : references.get(folder.parentId),
      links: folder.links.map((link) => ({
        name: link.name,
        url: link.url,
        collectionId: references.get(folder.id),
        tags: link.tags.map((tag) => ({ name: tag.name }))
      }))
    };
  });
  return { status: 200, response: { collections } };
}
