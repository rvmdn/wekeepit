const path = require('path');
const markdownParser = require('./markdown-parser.js');
const pdfParser = require('./pdf-parser.js');
const docxParser = require('./docx-parser.js');
const xlsxParser = require('./xlsx-parser.js');

const PARSER_REGISTRY = {
  '.md': markdownParser,
  '.markdown': markdownParser,
  '.pdf': pdfParser,
  '.docx': docxParser,
  '.xlsx': xlsxParser
};

function getParser(extensionOrFilename) {
  const ext = extensionOrFilename.startsWith('.')
    ? extensionOrFilename.toLowerCase()
    : path.extname(extensionOrFilename).toLowerCase();

  return PARSER_REGISTRY[ext] || null;
}

module.exports = {
  getParser,
  SUPPORTED_EXTENSIONS: Object.keys(PARSER_REGISTRY)
};
