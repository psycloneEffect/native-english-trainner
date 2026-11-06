# Documentation templates

## CHANGELOG

Follow the format at the top of `CHANGELOG.md`, and reuse the category names it already has, such as `修正`. Write for users, in Japanese. Put unreleased changes under `Unreleased`.

```markdown
## [0.9.0] - YYYY-MM-DD

### 修正

- 入力が空のときに生成ボタンを押せてしまう問題
```

Add the matching link at the bottom, in the same form as the existing links:

```markdown
[0.9.0]: https://github.com/psycloneEffect/native-english-trainner/releases/tag/v0.9.0
```

## JSDoc proposal

Name the target so that the implementer can apply it.

````markdown
`worker/input.js`, `normalize`:

```js
/**
 * 受け取ったボディを整形する。要件を満たさなければ null。
 *
 * @param {unknown} body リクエストボディ
 * @returns {{situation: string, native: string, ng: string} | null}
 */
```
````
