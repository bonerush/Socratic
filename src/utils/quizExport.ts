import type { QuizSet } from '../types';

/**
 * Convert a QuizSet into a human-readable Markdown string.
 */
export function buildQuizMarkdown(quizSet: QuizSet): string {
  const lines: string[] = [];
  const date = new Date(quizSet.generatedAt).toLocaleString();

  lines.push(`# ${quizSet.title}`);
  lines.push('');
  lines.push(`> **Generated at:** ${date} | **Source messages:** ${quizSet.sourceCount}`);
  lines.push('');

  for (let i = 0; i < quizSet.questions.length; i++) {
    const q = quizSet.questions[i]!;
    const typeLabel = formatQuestionType(q.type);

    lines.push(`## ${i + 1}. ${q.prompt} \`${typeLabel}\``);
    lines.push('');

    if (q.options && q.options.length > 0) {
      lines.push('**Options:**');
      for (const opt of q.options) {
        lines.push(`- ${opt}`);
      }
      lines.push('');
    }

    if (q.correctAnswer) {
      lines.push(`**Correct Answer:** ${q.correctAnswer}`);
      lines.push('');
    }

    if (q.explanation) {
      lines.push(`**Explanation:** ${q.explanation}`);
      lines.push('');
    }

    lines.push(`> Source: ${q.sourceNoteTitle}`);
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  return lines.join('\n');
}

function formatQuestionType(type: string): string {
  switch (type) {
    case 'multiple-choice':
      return 'MCQ';
    case 'fill-in-blank':
      return 'Fill-in';
    case 'open-ended':
      return 'Open';
    default:
      return type;
  }
}
