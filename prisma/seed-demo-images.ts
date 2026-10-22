import 'dotenv/config';
import crypto from 'crypto';
import { Prisma, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const plotImageVariants = [
  '/images/demo-plots/BL-00372.svg',
  '/images/demo-plots/BL-00841.svg',
  '/images/demo-plots/BL-01120.svg',
  '/images/demo-plots/BL-DEMO-LOCKED.svg',
  '/images/demo-plots/BL-DEMO-RESTRICTED.svg',
] as const;

const demoPlotLocations: Record<string, { latitude: number; longitude: number; precision: 'PLOT_COORDINATE' | 'DISTRICT_APPROXIMATE'; note: string }> = {
  'BL-00372': { latitude: 17.4412, longitude: 78.3489, precision: 'PLOT_COORDINATE', note: 'Existing demo plot coordinate; boundary not surveyed.' },
  'BL-00841': { latitude: 28.4089, longitude: 77.0677, precision: 'PLOT_COORDINATE', note: 'Existing demo plot coordinate; boundary not surveyed.' },
  'BL-01120': { latitude: 12.9716, longitude: 77.5946, precision: 'PLOT_COORDINATE', note: 'Existing demo plot coordinate; boundary not surveyed.' },
  'BL-DEMO-FROZEN': { latitude: 18.5204, longitude: 73.8567, precision: 'DISTRICT_APPROXIMATE', note: 'Illustrative district-level location, not an exact plot boundary.' },
  'BL-DEMO-JOINT': { latitude: 12.9716, longitude: 77.5946, precision: 'DISTRICT_APPROXIMATE', note: 'Illustrative district-level location, not an exact plot boundary.' },
  'BL-DEMO-LOCKED': { latitude: 17.3850, longitude: 78.4867, precision: 'DISTRICT_APPROXIMATE', note: 'Illustrative district-level location, not an exact plot boundary.' },
  'BL-DEMO-RESTRICTED': { latitude: 28.4595, longitude: 77.0266, precision: 'DISTRICT_APPROXIMATE', note: 'Illustrative district-level location, not an exact plot boundary.' },
};

const projectImages = [
  ['seed-project-riverline', '/images/demo-projects/riverline-commons.svg'],
  ['seed-project-northfield', '/images/demo-projects/northfield-assembly.svg'],
] as const;

async function main() {
  const lands = await prisma.land.findMany({
    select: { id: true, plotId: true, title: true, latitude: true, longitude: true, metadata: true },
    orderBy: { plotId: 'asc' },
  });
  const imageUsage = new Map<string, number>(plotImageVariants.map((imageUrl) => [imageUrl, 0]));
  const plots = [];
  for (const land of lands) {
    const existingMetadata = land.metadata && typeof land.metadata === 'object' && !Array.isArray(land.metadata)
      ? land.metadata as Prisma.JsonObject
      : {};
    const existingImageUrl = existingMetadata.imageUrl;
    const demoLocation = demoPlotLocations[land.plotId];
    let imageUrl = typeof existingImageUrl === 'string' && existingImageUrl.trim() ? existingImageUrl : '';
    if (!imageUrl || plotImageVariants.includes(imageUrl as typeof plotImageVariants[number])) {
      const leastUsed = Math.min(...imageUsage.values());
      const candidates = plotImageVariants.filter((variant) => imageUsage.get(variant) === leastUsed);
      const candidateIndex = crypto.createHash('sha256').update(land.plotId).digest().readUInt32BE(8) % candidates.length;
      imageUrl = candidates[candidateIndex];
      imageUsage.set(imageUrl, (imageUsage.get(imageUrl) || 0) + 1);
    }
    const updatedMetadata = {
      ...existingMetadata,
      imageUrl,
      imageAlt: typeof existingMetadata.imageAlt === 'string' && existingMetadata.imageAlt.trim()
        ? existingMetadata.imageAlt
        : `Illustrative demo image for ${land.title} (${land.plotId})`,
      ...(demoLocation ? {
        locationPrecision: demoLocation.precision,
        locationNote: demoLocation.note,
      } : {}),
    };
    plots.push(await prisma.land.update({
      where: { id: land.id },
      data: {
        metadata: updatedMetadata,
        ...(demoLocation && (land.latitude == null || land.longitude == null)
          ? { latitude: land.latitude ?? demoLocation.latitude, longitude: land.longitude ?? demoLocation.longitude }
          : {}),
      },
      select: { plotId: true },
    }));
  }

  const projects = await Promise.all(projectImages.map(async ([id, imageUrl]) => {
    const project = await prisma.project.findUnique({ where: { id }, select: { id: true } });
    if (!project) return null;
    return prisma.project.update({
      where: { id },
      data: { imageUrl, coverImageUrl: imageUrl },
      select: { title: true },
    });
  }));

  console.log(`Ensured illustrative images for all ${plots.length} plots and seeded images for ${projects.filter(Boolean).length} existing projects.`);
}

main()
  .catch((error: unknown) => {
    console.error('Demo image seeding failed.', error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
