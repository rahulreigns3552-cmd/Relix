function esc(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function selectionPage(input: {
  title: string;
  options: { id: string; label: string }[];
  state: string;
  step: string;
  tempToken: string;
  connectToken: string;
  profileRef: string;
  platform: string;
}): string {
  const options = input.options
    .map(
      (option) =>
        `<button class="opt" type="submit" name="choiceId" value="${esc(option.id)}">${esc(option.label)}</button>`,
    )
    .join('');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Choose an account · Relix</title>
  <style>
    body { margin: 0; font-family: Inter, system-ui, sans-serif; background: #fff7ed; color: #1c1917; }
    main { max-width: 440px; margin: 48px auto; background: #fff; border: 1px solid #fed7aa; border-radius: 16px; padding: 28px; }
    h1 { font-size: 22px; margin: 0 0 8px; }
    p { color: #78716c; margin: 0 0 18px; }
    .mark { width: 36px; height: 36px; border-radius: 10px; background: #f97316; color: white; display: grid; place-items: center; font-weight: 700; margin-bottom: 14px; }
    .opt { display: block; width: 100%; text-align: left; margin: 0 0 10px; padding: 12px 14px; border-radius: 10px; border: 1px solid #fdba74; background: #fff; font: inherit; cursor: pointer; }
    .opt:hover { background: #fff7ed; }
  </style>
</head>
<body>
  <main>
    <div class="mark">RX</div>
    <h1>${esc(input.title)}</h1>
    <p>Pick the account Relix should post to. You can disconnect it later from Channels.</p>
    <form method="post" action="/api/channels/callback/select">
      <input type="hidden" name="s" value="${esc(input.state)}" />
      <input type="hidden" name="step" value="${esc(input.step)}" />
      <input type="hidden" name="tempToken" value="${esc(input.tempToken)}" />
      <input type="hidden" name="connectToken" value="${esc(input.connectToken)}" />
      <input type="hidden" name="profileRef" value="${esc(input.profileRef)}" />
      <input type="hidden" name="platform" value="${esc(input.platform)}" />
      ${options || '<p>No accounts were returned. Go back to Channels and try again.</p>'}
    </form>
  </main>
</body>
</html>`;
}
