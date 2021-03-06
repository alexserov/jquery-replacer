#!/usr/bin/env node

const { parse, print } = require('recast');
const { visit, namedTypes, builders } = require('ast-types');
const { readFile, writeFile } = require('fs');
const { dirname, basename, extname, join, relative } = require('path');
const glob = require('glob');
const { promisify } = require('util');

const baseDirectory = process.cwd();
const searchPattern = (process.argv[process.argv.length - 1] || '-').replace(/^-$/, '**/*.{js,ts}');
const flags = {
    setters: true,
    getters: true,
    todos: true,
}
if (process.argv.length > 3) {
    const options = process.argv.slice(2, -1);
    const tempFlags = {}
    options.forEach(opt => {
        [...opt].forEach(char => {
            tempFlags[char] = true;
        })
    });
    const getFlagValue = (ch, def) => {
        const upper = ch.toUpperCase();
        const lower = ch.toLowerCase();
        if (tempFlags[upper])
            return true;
        if (tempFlags[lower])
            return false;
        return def;
    }
    flags.setters = getFlagValue('s', true);
    flags.getters = getFlagValue('g', true);
    flags.todos = getFlagValue('t', true);
}

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
            if (!flags.todos)
                return;
        }
        if (argLength && !flags.setters)
            return;
        if (!argLength && !flags.getters)
            return;
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

glob(join(baseDirectory, searchPattern), async (err, filePathes) => {
    const absoluteSizeJs = join(baseDirectory, 'js/core/utils/size');
    const fixedSizeJs = 'core/utils/size';
    filePathes = filePathes.filter(x => !x.endsWith('.d.ts'));
    let processed = filePathes.length;

    await Promise.all(filePathes.map(async (filePath) => {
        const fileString = (await promisify(readFile)(filePath)).toString();
        let pathToSizejs;
        if (!filePath.includes('testing')) {
            pathToSizejs = relative(dirname(filePath), absoluteSizeJs).replace(/\\/g, '/');
            if (pathToSizejs[0] !== '.') {
                pathToSizejs = './' + pathToSizejs;
            }
        } else {
            pathToSizejs = fixedSizeJs;
        }
        function getCode(node) {
            return fileString.substr(node.original.start, node.original.end - node.original.start);
        }


        const ast = parse(fileString, {
            parser: extname(filePath) === '.ts' ? require('recast/parsers/typescript') : require('recast/parsers/babel')
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
                        if (!flags.todos) {
                            this.traverse(path);
                            return;
                        }
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

                        const currentSpecifiers = path.node.specifiers.map(x => {
                            if (namedTypes.ImportDefaultSpecifier.check(x))
                                return '';
                            return x.imported.name;
                        });
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

        const result = print(ast, { quote: 'single', lineTerminator: '\n' });
        const ext = extname(filePath);
        const base = basename(filePath).slice(0, -ext.length);

        if (Object.keys(newAPI).length)
            await promisify(writeFile)(filePath, result.code);
        processed--;
        console.log(`Remaining: ${processed}`);
    }));
});
