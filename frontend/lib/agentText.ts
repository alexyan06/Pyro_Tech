export function sanitizeAgentText(text: string): string {
  return text
    .replace(/```(?:json)?[\s\S]*?```/gi, '')
    .replace(/```[\s\S]*$/g, '')
    .replace(/(?:\n\s*)?`{1,2}\s*$/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
