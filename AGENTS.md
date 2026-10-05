<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- OCR lives in src/lib/ocr.ts: one reusable tesseract.js eng+kor worker (lazy, browser-only), sparse word pass paired by row/column geometry, then per-cell single-line re-read of meanings. Why: plain page OCR scrambles vocabulary tables and Korean.
