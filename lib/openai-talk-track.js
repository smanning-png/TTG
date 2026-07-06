const DEFAULT_MODEL = "gpt-5.4-mini";
const DEFAULT_MAX_OUTPUT_TOKENS = 500;

export function getOpenAIModel(env = process.env) {
  return env.OPENAI_MODEL || DEFAULT_MODEL;
}

export function getHealthPayload(env = process.env) {
  const apiKeyConfigured = Boolean(env.OPENAI_API_KEY);
  return {
    ok: true,
    apiFunctionsDeployed: true,
    provider: "openai",
    apiKeyConfigured,
    fallbackAvailable: true,
    model: getOpenAIModel(env),
    note: apiKeyConfigured
      ? "OpenAI API key is set. If the tool still errors, check the error banner text."
      : "OpenAI API key is MISSING. Add OPENAI_API_KEY as a Databricks secret/app environment variable."
  };
}

function normalizeMessages(messages) {
  return messages.map((message) => ({
    role: message.role === "assistant" ? "assistant" : "user",
    content: String(message.content || "")
  }));
}

function extractOutputText(data) {
  if (typeof data.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }

  const output = Array.isArray(data.output) ? data.output : [];
  return output
    .flatMap((item) => Array.isArray(item.content) ? item.content : [])
    .filter((content) => content.type === "output_text" && typeof content.text === "string")
    .map((content) => content.text)
    .join("\n")
    .trim();
}

export async function createTalkTrackResponse(body, env = process.env) {
  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) {
    return {
      status: 500,
      data: { error: "Server is missing OPENAI_API_KEY. Add it as a Databricks secret/app environment variable." }
    };
  }

  const { system, messages } = body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return {
      status: 400,
      data: { error: "Request must include a non-empty messages array." }
    };
  }

  const model = getOpenAIModel(env);
  const maxOutputTokens = Number(env.OPENAI_MAX_OUTPUT_TOKENS || DEFAULT_MAX_OUTPUT_TOKENS);
  const payload = {
    model,
    instructions: system || undefined,
    input: normalizeMessages(messages),
    max_output_tokens: Number.isFinite(maxOutputTokens) ? maxOutputTokens : DEFAULT_MAX_OUTPUT_TOKENS,
    store: false,
    text: { format: { type: "text" } }
  };

  if (env.OPENAI_REASONING_EFFORT) {
    payload.reasoning = { effort: env.OPENAI_REASONING_EFFORT };
  }

  try {
    const openAIRes = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const raw = await openAIRes.text();
    let data;
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch (err) {
      return {
        status: 502,
        data: {
          error: `OpenAI returned a non-JSON response (${openAIRes.status}).`,
          details: raw.slice(0, 300)
        }
      };
    }

    if (!openAIRes.ok) {
      return {
        status: openAIRes.status,
        data: { error: data.error?.message || data.error || `OpenAI request failed with status ${openAIRes.status}` }
      };
    }

    const text = extractOutputText(data);
    if (!text) {
      return {
        status: 502,
        data: { error: "OpenAI returned no text output." }
      };
    }

    return {
      status: 200,
      data: {
        id: data.id,
        model: data.model || model,
        content: [{ type: "text", text }],
        usage: data.usage || null
      }
    };
  } catch (err) {
    return {
      status: 502,
      data: { error: `OpenAI proxy error: ${err.message}` }
    };
  }
}
