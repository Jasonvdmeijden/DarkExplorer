/* Zip operations — preview, extract, create */
const AdmZip = require('adm-zip');
const path   = require('path');
const { promises: fsp } = require('fs');

function previewZip(zipPath) {
  const zip = new AdmZip(zipPath);
  return zip.getEntries()
    .map(e => ({
      name:           e.entryName,
      size:           e.header.size,
      compressedSize: e.header.compressedSize,
      isDir:          e.isDirectory,
    }))
    .sort((a, b) => {
      if (a.isDir !== b.isDir) return b.isDir - a.isDir;
      return a.name.localeCompare(b.name);
    });
}

async function extractZip(zipPath, destDir) {
  await fsp.mkdir(destDir, { recursive: true });
  const zip = new AdmZip(zipPath);
  zip.extractAllTo(destDir, true);
}

async function createZipBuffer(sourcePaths) {
  const zip = new AdmZip();
  for (const src of sourcePaths) {
    const stat = await fsp.stat(src).catch(() => null);
    if (!stat) continue;
    if (stat.isDirectory()) {
      zip.addLocalFolder(src, path.basename(src));
    } else {
      zip.addLocalFile(src);
    }
  }
  return zip.toBuffer();
}

async function createZip(sourcePaths, outputPath) {
  const zip = new AdmZip();
  for (const src of sourcePaths) {
    const stat = await fsp.stat(src).catch(() => null);
    if (!stat) continue;
    if (stat.isDirectory()) {
      zip.addLocalFolder(src, path.basename(src));
    } else {
      zip.addLocalFile(src);
    }
  }
  zip.writeZip(outputPath);
  return outputPath;
}

module.exports = { previewZip, extractZip, createZipBuffer, createZip };
