// Browser-safe entry (`@codegraph/extractors/browser`): everything needed to index files that are already in memory.
// The main entry also exports `indexRepo`, which reads the disk with node:fs.
export { indexFiles, type IndexOptions, type IndexResult } from './index-files';
export { createFilter, CONFIG_NAMES, DEFAULT_IGNORES, type FileFilter, type FilterOptions } from './filter';
