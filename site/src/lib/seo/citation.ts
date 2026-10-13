import fs from 'node:fs';
export const citationFile = fs.readFileSync('../CITATION.cff', 'utf8');
export const softwareVersion = citationFile.match(/^version:\s*(.+)$/m)![1].trim();
