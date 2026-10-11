// Shared source of truth for physical-direction detection (ESLint rule + CSS test).
// Only logical utilities/properties (ms-, me-, ps-, pe-, start-, end-, text-start, border-s...) are allowed.
export const physicalClassPattern = new RegExp(
  '(?:^|[\\s:!"\'`])-?(?:' +
    [
      '(?:m|p|scroll-m|scroll-p)[lr]-',
      '(?:left|right)-',
      'text-(?:left|right)\\b',
      'float-(?:left|right)\\b',
      'clear-(?:left|right)\\b',
      'border-[lr](?:-|\\b)',
      'rounded-(?:l|r|tl|tr|bl|br)(?:-|\\b)',
      'space-x-',
      'divide-x\\b',
    ].join('|') +
    ')',
);

export const physicalCssPattern =
  /(?:^|[;{\s])(?:margin|padding|border|scroll-margin|scroll-padding)-(?:left|right)\b|(?:^|[;{\s])(?:left|right)\s*:|text-align\s*:\s*(?:left|right)\b|float\s*:\s*(?:left|right)\b|border-(?:top|bottom)-(?:left|right)-radius/;

export const noPhysicalDirection = {
  meta: { type: 'problem', schema: [], messages: { physical: 'Physical direction utility "{{text}}": use logical properties (ms/me/ps/pe/start/end/text-start/border-s/rounded-s).' } },
  create(context) {
    const check = (node, text) => {
      if (typeof text === 'string' && physicalClassPattern.test(text)) context.report({ node, messageId: 'physical', data: { text: text.trim().slice(0, 60) } });
    };
    return {
      Literal: (node) => check(node, node.value),
      TemplateElement: (node) => check(node, node.value.cooked),
    };
  },
};
