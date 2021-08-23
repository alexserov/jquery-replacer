const { parse, print } = require('recast');
const { visit, namedTypes, builders } = require('ast-types');
const { readFileSync, writeFileSync } = require('fs');
const { dirname, basename, extname, join } = require('path');

const filePathes = [
    'C:\\work\\DevExtreme\\js\\events\\swipe.js',
    'C:\\work\\DevExtreme\\js\\ui\\lookup.js',
    'C:\\work\\DevExtreme\\js\\ui\\popover.js'
];

filePathes.forEach((filePath) => {
    const fileString = readFileSync(filePath).toString();
    const ast = parse(fileString, {
        sourceType: 'module'
    });

    function getCode(node) {
        return fileString.substr(node.start, node.end - node.start);
    }

    const replacementTable = {
        height(path, callee) {
            path.replace(
                builders.callExpression(
                    builders.identifier('calculateHeight'),
                    [callee.object, ...path.node.arguments]
                )
            );
        },
        width(path, callee) {

        }
    }

    visit(ast, {
        visitCallExpression(path) {
            let code = getCode(path.node);

            let name;
            const callee = path.node.callee;
            if (namedTypes.MemberExpression.check(callee)) {
                name = callee.property.name;
            } else {
                this.traverse(path);
                return;
            }
            const replacement = replacementTable[name];
            if (replacement) {
                replacement(path, callee);
            }
            this.traverse(path);
        },
    });

    const result = print(ast);

    writeFileSync(join(dirname(filePath), `${basename(filePath)}_modified.${extname(filePath)}`), result.code);
})
