/**
 * Google OAuth 2.0 – lightweight implementation that doesn't require passport.
 * Uses direct HTTPS requests so no extra npm packages are needed.
 */

const https = require("https");
const { stringEnv } = (() => {
  // inline minimal env helpers to avoid circular imports
  function stringEnv(name, fallback = "") {
    const v = process.env[name];
    return v == null || v === "" ? fallback : v;
  }
  return { stringEnv };
})();

const GOOGLE_CLIENT_ID = () => stringEnv("GOOGLE_CLIENT_ID", "");
const GOOGLE_CLIENT_SECRET = () => stringEnv("GOOGLE_CLIENT_SECRET", "");
const GOOGLE_CALLBACK_URL = () => stringEnv("GOOGLE_CALLBACK_URL", "");

const GOOGLE_AUTH_BASE = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";

const SCOPES = ["openid", "email", "profile"].join(" ");

/**
 * Build the redirect URL that sends the user to Google's consent screen.
 * @param {string} state  - opaque string to protect against CSRF
 * @param {string} [hintRole] - custom param stored in state to know what kind of
 *                              account to create after login (customer|partner|promoter)
 */
function buildAuthUrl(state, hintRole = "customer") {
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID(),
    redirect_uri: GOOGLE_CALLBACK_URL(),
    response_type: "code",
    scope: SCOPES,
    state: JSON.stringify({ csrf: state, role: hintRole }),
    access_type: "online",
    prompt: "select_account"
  });
  return `${GOOGLE_AUTH_BASE}?${params.toString()}`;
}

/**
 * Exchange an authorisation code for tokens.
 */
function exchangeCode(code) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID(),
      client_secret: GOOGLE_CLIENT_SECRET(),
      redirect_uri: GOOGLE_CALLBACK_URL(),
      grant_type: "authorization_code"
    }).toString();

    const req = https.request(
      {
        hostname: "oauth2.googleapis.com",
        path: "/token",
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(body)
        }
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => { data += chunk; });
        res.on("end", () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) return reject(new Error(parsed.error_description || parsed.error));
            resolve(parsed);
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

/**
 * Fetch the Google user's profile using an access token.
 */
function fetchUserInfo(accessToken) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "www.googleapis.com",
        path: "/oauth2/v2/userinfo",
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` }
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => { data += chunk; });
        res.on("end", () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) return reject(new Error(parsed.error.message || "Google userinfo error"));
            resolve(parsed);
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on("error", reject);
    req.end();
  });
}

/**
 * Full flow: exchange code → fetch profile → return normalised user info.
 */
async function resolveGoogleUser(code) {
  const tokens = await exchangeCode(code);
  const profile = await fetchUserInfo(tokens.access_token);

  return {
    googleId: profile.id,
    email: String(profile.email || "").toLowerCase().trim(),
    name: String(profile.name || profile.given_name || "").trim(),
    emailVerified: Boolean(profile.verified_email)
  };
}

function isConfigured() {
  return Boolean(GOOGLE_CLIENT_ID() && GOOGLE_CLIENT_SECRET() && GOOGLE_CALLBACK_URL());
}

module.exports = { buildAuthUrl, resolveGoogleUser, isConfigured };
