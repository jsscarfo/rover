import { Anthropic } from '@anthropic-ai/sdk';

export class ContextCompressor {
  constructor() {
    this.anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }

  async compressContext(fullContext, maxTokens = 4000) {
    if (!fullContext || fullContext.trim() === '') {
      return '';
    }

    try {
      const response = await this.anthropic.messages.create({
        model: 'claude-3-haiku-20240307',
        max_tokens: maxTokens,
        messages: [
          {
            role: 'user',
            content: `Please summarize the following project context concisely, focusing on key architectural decisions, module structures, and important constraints. Keep the summary under ${maxTokens} tokens.\n\nContext:\n${fullContext}`
          }
        ]
      });

      return response.content[0].text;
    } catch (error) {
      console.error('Failed to compress context:', error);
      // Fallback: truncate the context if API call fails
      return fullContext.substring(0, maxTokens * 4) + '... (truncated due to compression failure)';
    }
  }
}

export const contextCompressor = new ContextCompressor();
