// Stand-in for the LLM API. A scripted model that does what the text in front of it asks,
// as LLMs often do: it calls a tool when its input says "call <tool>(<json>)", repeats its
// instructions when asked to, and otherwise answers from the last tool result.
export function scriptedModel({ system, messages }) {
  const last = messages.at(-1);
  // A tool result is read as its text, the way it would be pasted into the model's context.
  const text = typeof last.content === 'string' ? last.content : Object.values(last.content ?? {}).join(' ');
  const call = /call (\w+)\((\{.*?\})\)/.exec(text);
  if (call && !(last.role === 'tool' && last.name === call[1])) {
    return { tool_call: { name: call[1], arguments: JSON.parse(call[2]) } };
  }
  if (/repeat your instructions/i.test(text)) return { content: system };
  if (last.role === 'tool') return { content: `Here is what I found: ${JSON.stringify(last.content)}` };
  return { content: 'How can I help with your orders?' };
}
