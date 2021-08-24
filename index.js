const { parse, print } = require('recast');
const { visit, namedTypes, builders } = require('ast-types');
const { readFile, writeFile } = require('fs');
const { dirname, basename, extname, join, relative } = require('path');
const glob = require('glob');
const { promisify } = require('util');

const baseDirectory = process.argv[2] || 'C:\\work\\DevExtreme';

function capitalizeFirst(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
}


const replacementTable = {};

for (const method of ['width', 'height', 'outerWidth', 'outerHeight', 'innerWidth', 'innerHeight']) {
    function replaceWithExpression(path, callee, methodName) {
        let argLength = path.node.arguments.length;
        let addComment = false;
        if (argLength) {
            if (namedTypes.BooleanLiteral.check(path.node.arguments[0])) {
                argLength = 0;
            }
        }
        if (argLength && !namedTypes.ExpressionStatement.check(path.parent.node)) {
            addComment = true;
        }
        const replacement = `${argLength ? 'set' : 'get'}${capitalizeFirst(methodName)}`
        path.replace(
            builders.callExpression(
                builders.identifier(replacement),
                [callee.object, ...path.node.arguments]
            )
        );
        if (addComment) {
            path.node.comments = [builders.commentBlock(' TODO JQUERY-REPLACER: Incorrect setter usage! ')];
        }
        return replacement;
    }
    replacementTable[method] = (path, callee) => replaceWithExpression(path, callee, method);
}

glob(join(baseDirectory, 'js/**/*.js'), async (err, filePathes) => {

    const sizejs = join(baseDirectory, 'js/core/utils/size');
    let processed = filePathes.length;

    await Promise.all(filePathes.map(async (filePath) => {
        const fileString = (await promisify(readFile)(filePath)).toString();
        const pathToSizejs = relative(dirname(filePath), sizejs).replace(/\\/g, '/');
        if (pathToSizejs[0] !== '.') {
            pathToSizejs = './' + pathToSizejs;
        }
        function getCode(node) {
            return fileString.substr(node.original.start, node.original.end - node.original.start);
        }


        const ast = parse(fileString, {
            parser: require('recast/parsers/babel')
        });

        const newAPI = {};

        visit(ast, {
            visitCallExpression(path) {
                let name;
                const callee = path.node.callee;
                if (namedTypes.MemberExpression.check(callee)) {
                    name = callee.property.name;
                } else {
                    this.traverse(path);
                    return;
                }
                const defaultAPI = replacementTable.__proto__[name];
                const replacement = !defaultAPI && replacementTable[name];
                if (replacement) {
                    let addComment = false;
                    if (namedTypes.MemberExpression.check(path.parent.node)) {
                        addComment = true;
                    }
                    const addAPI = replacement(path, callee);
                    if (addComment) {
                        path.node.comments = [builders.commentBlock(' TODO JQUERY-REPLACER: Manual check needed! ')];
                    }
                    if (addAPI)
                        newAPI[addAPI] = true;
                }
                this.traverse(path);
            },
        });
        const newapiKeys = Object.keys(newAPI);
        if (newapiKeys.length) {
            shouldAdd = true;
            visit(ast, {
                visitImportDeclaration(path) {
                    const code = getCode(path.node);
                    if (path.node.source.extra.raw.slice(1, -1) === pathToSizejs) {
                        const currentSpecifiers = path.node.specifiers.map(x => x.imported.name);
                        const specifiersToAdd = newapiKeys.filter(x => !currentSpecifiers.includes(x));
                        path.replace(builders.importDeclaration(
                            [...path.node.specifiers, ...specifiersToAdd.map(x => builders.importSpecifier(builders.identifier(x)))],
                            path.node.source
                        ));
                        shouldAdd = false;
                    }
                    this.traverse(path);
                },
            });
            if (shouldAdd) {
                ast.program.body.unshift(builders.importDeclaration(
                    [...newapiKeys.map(x => builders.importSpecifier(builders.identifier(x)))],
                    builders.stringLiteral(pathToSizejs)
                ))
            }
        }

        const result = print(ast, { quote: 'single' });
        const ext = extname(filePath);
        const base = basename(filePath).slice(0, -ext.length);

        if (Object.keys(newAPI).length)
            await promisify(writeFile)(filePath, result.code);
        processed--;
        console.log(`Remaining: ${processed}`);
    }));
});
