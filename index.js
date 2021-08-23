const parser = require('@babel/parser');
const generator = require('@babel/generator').default;
const traverse = require('@babel/traverse').default;
const types = require('@babel/types');
const { readFileSync, writeFileSync } = require('fs');
const { dirname, basename, extname, join } = require('path');

const filePathes = [
    'C:\\work\\DevExtreme\\js\\events\\swipe.js',
    'C:\\work\\DevExtreme\\js\\ui\\lookup.js',
    'C:\\work\\DevExtreme\\js\\ui\\popover.js'
];

filePathes.forEach((filePath) => {
    const fileString = readFileSync(filePath).toString();
    const ast = parser.parse(fileString, {
        sourceType: 'module'
    });

    function getCode(node) {
        return fileString.substr(node.start, node.end - node.start);
    }

    const replacementTable = {
        height(path, callee) {
            path.replaceWith(
                types.callExpression(
                    types.identifier('calculateHeight'),
                    [callee.object, ...path.node.arguments]
                )
            );            
        },
        width(path, callee) {

        }
    }

    traverse(ast, {
        CallExpression(path) {
            let code = getCode(path.node);

            let name;
            const callee = path.node.callee;
            if (types.isMemberExpression(callee)) {
                name = callee.property.name;
            } else {
                return;
            }
            const replacement = replacementTable[name];
            if (replacement) {
                replacement(path, callee);
            }
        },
    });

    const result = generator(ast);

    writeFileSync(join(dirname(filePath), `${basename(filePath)}_modified.${extname(filePath)}`), result.code);
})
