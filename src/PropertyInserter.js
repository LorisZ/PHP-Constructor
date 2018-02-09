const vscode = require('vscode');

module.exports = class PropertyInserter {
    async insert() {
        let activeDocument = this.activeDocument().uri;

        if (activeDocument === undefined) {
            return;
        }

        let declarations = await this.getDeclarations(activeDocument);

        if (declarations.constructorLineNumber === null) {
            this.insertConstructor(declarations);
        } else {
            this.insertConstructorProperty(declarations);
        }
    }

    async getDeclarations(activeDocument) {
        let declarations = {
            classLineNumber: null,
            traitUseLineNumber: null,
            lastPropertyLineNumber: null,
            constructorLineNumber: null,
            constructorRange: null,
            constructorClosingLineNumber: null,
        };

        let doc = await vscode.workspace.openTextDocument(activeDocument);

        for (let line = 0; line < doc.lineCount; line++) {
            let textLine = doc.lineAt(line).text;

            if (/class \w/.test(textLine)) {
                let lineNumber = line;

                // If class closing brace isn't inline then increment lineNumber.
                if (! textLine.endsWith('{')){
                    lineNumber++;
                }

                declarations.classLineNumber = lineNumber;
            }

            if (declarations.classLineNumber !== null && /use .+?;/.test(textLine)) {
                declarations.traitUseLineNumber = line;
            }

            if (/(public|protected|private|static) \$/.test(textLine)) {
                declarations.lastPropertyLineNumber = this.findPropertyLastLine(doc, line);
            }

            if (/function __construct/.test(textLine)) {
                declarations.constructorLineNumber = line;

                declarations.constructorRange = this.findConstructorRange(doc, line);
            }

            if (declarations.constructorLineNumber !== null && /[ \t].+}/.test(textLine)) {
                declarations.constructorClosingLineNumber = line;

                // If constructor is found then no need to parse anymore.
                break;
            }
        }

        return declarations;
    }

    insertConstructor(declarations) {
        let insertLine = this.gotoLine(declarations);

        let snippet = '\n';

        if (! declarations.lastPropertyLineNumber && ! declarations.traitUseLineNumber) {
            // If no property and trait uses is found then no need to prepend a line break.
            snippet = '';
        }

        snippet += `\t${this.config('visibility')}` + ' \\$${1:property};\n\n' +
        `\t${this.config('constructor_visibility')} ` + 'function __construct(\\$${1:property})\n' +
        '\t{\n' +
            '\t\t\\$this->${1:property} = \\$${1:property};$0\n' +
        '\t}';

        let nextLineOfInsertLine = this.activeEditor().document.lineAt(insertLine.lineNumber + 1);

        // If insert line is class closing brace or insert line is empty and
        // next line is not class closing brace then add one new line.
        if (insertLine.text.endsWith('}') ||
            (insertLine.text === '' && ! nextLineOfInsertLine.text.endsWith('}'))
        ) {
            snippet += '\n';
        }

        if (insertLine.text !== '' && ! insertLine.text.endsWith('}')) {
            //Insert line is not empty and next line is not class closing brace so add two new line.
            snippet += '\n\n';
        }

        this.activeEditor().insertSnippet(
            new vscode.SnippetString(snippet)
        );
    }

    async insertConstructorProperty(declarations) {
        this.gotoLine(declarations);

        let snippet = `\t${this.config('visibility')}` + ' \\$${1:property};\n\n';

        let constructorStartLineNumber = declarations.constructorRange.start.line;
        let constructorLineText = this.activeEditor().document.getText(declarations.constructorRange);

        if (constructorLineText.endsWith('/**')) {
            snippet += await this.getConstructorDocblock(declarations.constructorRange);

            // console.log(await this.getConstructorLine(declarations.constructorRange));return;
            let constructor = await this.getConstructorLine(declarations.constructorRange);

            constructorStartLineNumber = constructor.line;
            constructorLineText = constructor.textLine;
        }

        // Split constructor arguments.
        let constructor = constructorLineText.split(/\((.*?)\)/);

        snippet += `${constructor[0]}(`;

        // Escape all "$" signs of constructor arguments otherwise
        // vscode will assume "$" sign is a snippet placeholder.
        let previousArgs = constructor[1].replace(/\$/g, '\\$');

        if (previousArgs.length !== 0)  {
            // Add previous constructor arguments.
            snippet += `${previousArgs}\, `;
        }

        snippet += '\\$\${1:property})';

        let constructorClosingLine;

        // Add all previous property assignments to the snippet.
        for (var line = constructorStartLineNumber; line < declarations.constructorClosingLineNumber; line++) {
            let propertyAssignment = this.activeEditor().document.lineAt(line + 1);

            constructorClosingLine = propertyAssignment;

            // Escape all "$" signs of property assignments.
            snippet += '\n' + propertyAssignment.text.replace(/\$/g, '\\$');
        }

        // Slice constructor closing brace.
        snippet = snippet.slice(0, -1);

        snippet += '\t\\$this->${1:property} = \\$${1:property};$0';
        snippet += '\n\t}';

        let nextLineOfConstructorClosing = this.activeEditor().document.lineAt(constructorClosingLine.lineNumber + 1).text;

        // If there is no new line after constructor closing brace then append
        // new line except if the next line is not class closing brace.
        if (nextLineOfConstructorClosing !== '' && ! nextLineOfConstructorClosing.endsWith('}')) {
            snippet += '\n';
        }

        let start = new vscode.Position(
            declarations.constructorRange.start.line,
            declarations.constructorRange.start.character
        );

        let end = new vscode.Position(
            constructorClosingLine.range.end.line,
            constructorClosingLine.range.end.character
        );

        this.activeEditor().insertSnippet(
            new vscode.SnippetString(snippet),
            new vscode.Range(start, end)
        );
    }

    gotoLine(declarations) {
        let insertLineNumber = this.getInsertLine(declarations);

        let insertLine = this.activeEditor().document.lineAt(insertLineNumber);
        this.activeEditor().revealRange(insertLine.range);

        let newPosition = new vscode.Position(insertLineNumber, 0);
        this.activeEditor().selection = new vscode.Selection(newPosition, newPosition);

        return insertLine;
    }

    getInsertLine(declarations) {
        let lineNumber = declarations.lastPropertyLineNumber || declarations.traitUseLineNumber || declarations.classLineNumber;

        return ++lineNumber;
    }

    findPropertyLastLine(doc, line) {
        for (line; line < doc.lineCount; line++) {
            let textLine = doc.lineAt(line).text;

            if (textLine.endsWith(';')) {
                return line;
            }
        }
    }

    constructorHasDocBlock(doc, line) {
        return doc.lineAt(line).text.endsWith('*/');
    }

    findConstructorRange(doc, line) {
        if (! doc.lineAt(line - 1).text.endsWith('*/')) {
            // Constructor doesn't have any docblock.
            return doc.lineAt(line).range;
        }

        for (line; line < doc.lineCount; line--) {
            let textLine = doc.lineAt(line).text;

            if (textLine.endsWith('/**')) {
                return doc.lineAt(line).range;
            }
        }
    }

    async getConstructorDocblock(range) {
        let doc = await vscode.workspace.openTextDocument(this.activeDocument().uri);

        let line = range.start.line;

        let docblock = '';

        for (line; line < doc.lineCount; line++) {
            let textLine = doc.lineAt(line).text;

            if (/function __construct/.test(textLine)) {
                break;
            }

            docblock += `${textLine}\n`;
        }

        return docblock.replace(/\$/g, '\\$');
    }

    async getConstructorLine(range) {
        let doc = await vscode.workspace.openTextDocument(this.activeDocument().uri);

        let line = range.start.line;

        for (line; line < doc.lineCount; line++) {
            let textLine = doc.lineAt(line).text;

            if (/function __construct/.test(textLine)) {
                return {
                    line,
                    textLine,
                };
            }
        }
    }

    activeEditor() {
        return vscode.window.activeTextEditor;
    }

    activeDocument() {
        return this.activeEditor().document;
    }

    config(key) {
        return vscode.workspace.getConfiguration('phpConstructor').get(key);
    }
}
