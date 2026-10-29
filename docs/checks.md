# Checking your code

Whisk checks every file as you type and underlines problems. The count shows in the status bar; press F8 to jump to the next one. Some come with a quick fix (Alt+Enter), like removing trailing spaces.

There are two kinds of check:

- **Language server errors.** Compiler errors and warnings from the language's own server, once it's installed. These are exact.
- **Whisk's rules.** Simple checks that work on any language, with or without a server:

| Rule | Default |
|---|---|
| Trailing whitespace | Note |
| Newline at end of file | Note |
| Too many blank lines (more than 2) | Note |
| Line too long (over 150 characters) | Note |
| Mixed indentation (spaces in a tab file, or the reverse) | Warning |
| TODO, FIXME and HACK comments | Note |
| Nesting too deep (more than 4 levels in a method) | Warning |
| Method too long (over 80 lines) | Warning |
| Too many parameters (more than 5) | Warning |
| Method too complex (more than 15 branches) | Warning |
| File too long (over 800 lines) | Note |
| Empty `catch` block | Warning |
| Leftover debug output (`Debug.Log`, `console.log`…) | Off |

Change any of them in **Settings › Linter**: turn a rule off, make it a warning or an error, or change its limit. You can also add your own rules with a regular expression, and list paths to skip.

## Sharing rules with your team

Click **Create .whisk/lint.json** in **Settings › Linter**. Whisk saves your rules into the project, and anything in that file wins over each person's own settings. Commit it like any other file:

```json
{
  "rules": {
    "max-nesting": { "severity": "error", "options": { "max": 2 } },
    "debug-output": { "severity": "warning" }
  },
  "custom": [
    {
      "id": "no-find-object",
      "pattern": "FindObjectOfType",
      "message": "Cache this in Awake instead",
      "severity": "warning",
      "files": "*.cs"
    }
  ],
  "ignore": ["Assets/Plugins/**", "**/*.g.cs"]
}
```
