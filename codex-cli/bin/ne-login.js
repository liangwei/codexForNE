import { constants, publicEncrypt } from "crypto";

const NE_UC_BASE_URL = "http://uc.inoteexpress.com";
const NE_LOGIN_PATH = "/user/passwordlogin";
const NE_DICT_PATH = "/user/dict";
const LOGIN_EXPIRE_SECONDS = "2592000";

export async function loginToNe(input, options = {}) {
  validateLoginInput(input);
  const fetchImpl = options.fetchImpl ?? fetch;
  const publicKey = await fetchNePublicKey(fetchImpl);
  const encryptedPassword = encryptNePassword(input.password, publicKey);
  const response = await postNeLogin(fetchImpl, input.username, encryptedPassword);
  return parseNeLoginResponse(response);
}

function validateLoginInput(input) {
  if (!input.username.trim()) {
    throw new Error("NE login username cannot be empty.");
  }
  if (!input.password) {
    throw new Error("NE login password cannot be empty.");
  }
}

async function fetchNePublicKey(fetchImpl) {
  const response = await fetchImpl(`${NE_UC_BASE_URL}${NE_DICT_PATH}`);
  const data = await readJsonResponse(response, "NE public key");
  const publicKey = data?.data?.public_key;
  if (typeof publicKey !== "string" || !publicKey.trim()) {
    throw new Error("NE public key response did not include data.public_key.");
  }
  return publicKey;
}

function encryptNePassword(password, publicKey) {
  return publicEncrypt(
    { key: publicKey, padding: constants.RSA_PKCS1_PADDING },
    Buffer.from(password, "utf8"),
  ).toString("base64");
}

async function postNeLogin(fetchImpl, username, encryptedPassword) {
  const body = new URLSearchParams({
    target: username,
    password: encryptedPassword,
    expire: LOGIN_EXPIRE_SECONDS,
  });
  const response = await fetchImpl(`${NE_UC_BASE_URL}${NE_LOGIN_PATH}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      accept: "application/json, text/plain, */*",
    },
    body,
  });
  return readJsonResponse(response, "NE login");
}

async function readJsonResponse(response, label) {
  if (!response.ok) {
    throw new Error(`${label} request failed: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

function parseNeLoginResponse(response) {
  const token = response?.data?.token;
  if (response?.code !== 0 && response?.code !== "0") {
    throw new Error(
      `NE login failed: ${String(response?.msg ?? response?.code ?? "unknown error")}`,
    );
  }
  if (typeof token !== "string" || !token.trim()) {
    throw new Error("NE login response did not include data.token.");
  }
  return {
    token,
    accountId: stringValue(response.data?.account_id),
    displayName: stringValue(response.data?.email) ?? stringValue(response.data?.mobile),
  };
}

function stringValue(value) {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (typeof value === "number") {
    return String(value);
  }
  return undefined;
}
