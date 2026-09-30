/**
 * Sends mail over Resend's HTTP API instead of SMTP.
 *
 * This exists because several managed hosts block outbound SMTP outright --
 * Render's free tier among them, which is where this app runs. On such a host
 * no SMTP credentials work, because nothing is wrong with the credentials: the
 * connection never opens. An HTTPS request on 443 goes out where port 587 and
 * 465 do not.
 *
 * The shape deliberately mirrors the part of nodemailer's transport that
 * email.js uses -- sendMail() and verify() -- so the calling code does not care
 * which one it holds.
 */
const API = 'https://api.resend.com';

// Long enough for a slow API, short enough that a hung request cannot pile up
// behind a resident's page load. Notifications are fire-and-forget, so a
// timeout here costs a notification, not a request.
const TIMEOUT_MS = 15000;

// How Resend describes a key that may only send. Matched on the wording
// because the status code it arrives with does not distinguish it from a key
// that is outright invalid.
const RESTRICTED = /restricted|only send/i;

const request = async (path, { method = 'GET', apiKey, body, apiBase = API } = {}) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${apiBase}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    const text = await response.text();
    let payload;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      // A proxy or error page rather than the API. Keep a little of it: the
      // body is the only clue about what answered instead.
      payload = { message: text.slice(0, 200) };
    }

    if (!response.ok) {
      const detail = payload.message || payload.error || response.statusText;
      const error = new Error(`Resend responded ${response.status}: ${detail}`);
      error.statusCode = response.status;
      throw error;
    }

    return payload;
  } catch (err) {
    // AbortError says "timed out", which is not obvious from its own message.
    if (err.name === 'AbortError') {
      throw new Error(`Resend did not respond within ${TIMEOUT_MS / 1000}s`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Builds a transport bound to one API key. Nothing is validated here -- a bad
 * key is only discoverable by calling the API, which verify() does.
 */
const createMailer = ({ apiKey, apiBase = API }) => ({
  kind: 'resend',

  async sendMail({ from, to, subject, html, text }) {
    const result = await request('/emails', {
      method: 'POST',
      apiKey,
      apiBase,
      body: {
        from,
        // The API takes an array; a single string is accepted too, but being
        // explicit keeps one code path.
        to: Array.isArray(to) ? to : [to],
        subject,
        ...(html ? { html } : {}),
        ...(text ? { text } : {}),
      },
    });
    // Named to match nodemailer's result, which email.js does not read but
    // check:email prints.
    return { messageId: result.id, accepted: Array.isArray(to) ? to : [to] };
  },

  /**
   * Proves the key is real and accepted. Listing domains is a cheap
   * authenticated GET that sends nothing, so it can run at every boot.
   *
   * A sending-only key is the right key to issue here -- it can do nothing
   * but send -- and it is not permitted to list domains. That refusal means
   * the key is valid and correctly scoped, which is the opposite of a
   * problem, so it must not be reported as a failed check. Only an outright
   * rejection of the credential is a real failure.
   */
  async verify() {
    try {
      await request('/domains', { apiKey, apiBase });
      return { ok: true, verified: true };
    } catch (err) {
      // Resend answers a restricted key with 401 and an explanatory message,
      // not the 403 the status alone would suggest -- the same status it uses
      // for a key that is simply wrong. So the message is what separates
      // "correctly scoped" from "invalid", and the status cannot.
      if (RESTRICTED.test(err.message || '')) {
        return {
          ok: true,
          verified: false,
          note: 'sending-only key: valid, but cannot be checked further before a real send',
        };
      }
      throw err;
    }
  },
});

module.exports = { createMailer, API, TIMEOUT_MS };
