"use strict";

const {
  readDatabase,
  writeDatabase,
  updateDatabase,
  deleteDatabase,
  isRealtimeDatabaseConfigured
} = require("./firebaseAdmin");

/*
========================================================
 NIVORA ONE — AI TOOL ROUTER
 Firebase Realtime Database Root:
 /nivora
========================================================
*/

const DB_ROOT = "nivora";

/* ------------------------------------------------------
   AI TOOL DEFINITIONS
------------------------------------------------------ */

const TOOL_DEFINITIONS = [
  {
    name: "calculator",
    description:
      "Perform mathematical calculations for the user.",
    parameters: {
      type: "object",
      properties: {
        expression: {
          type: "string",
          description: "Mathematical expression such as 1250*8/100"
        }
      },
      required: ["expression"]
    }
  },

  {
    name: "get_current_time",
    description:
      "Get the current date and time.",
    parameters: {
      type: "object",
      properties: {}
    }
  },

  {
    name: "business_summary",
    description:
      "Read NIVORA business income, expense, sales, purchase and profit information from Firebase.",
    parameters: {
      type: "object",
      properties: {}
    }
  },

  {
    name: "stock_summary",
    description:
      "Read NIVORA product and stock information from Firebase.",
    parameters: {
      type: "object",
      properties: {}
    }
  },

  {
    name: "ledger_summary",
    description:
      "Read NIVORA customer ledger, due and payment information from Firebase.",
    parameters: {
      type: "object",
      properties: {}
    }
  },

  {
    name: "customer_search",
    description:
      "Search customer information stored in NIVORA.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Customer name, phone number or keyword"
        }
      },
      required: ["query"]
    }
  },

  {
    name: "product_search",
    description:
      "Search NIVORA products and stock.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Product name, code or keyword"
        }
      },
      required: ["query"]
    }
  }
];


/* ------------------------------------------------------
   SAFE CALCULATOR
------------------------------------------------------ */

function calculator(expression) {

  if (typeof expression !== "string") {
    throw new Error("Invalid mathematical expression.");
  }

  const clean = expression
    .replace(/\s+/g, "")
    .replace(/,/g, "");

  /*
   Only basic mathematical characters are allowed.
   No letters, variables, functions or code.
  */
  if (!/^[0-9+\-*/().%]+$/.test(clean)) {
    throw new Error("Only basic mathematical expressions are allowed.");
  }

  if (clean.length > 200) {
    throw new Error("Expression is too long.");
  }

  try {

    const result = Function(
      `"use strict"; return (${clean})`
    )();

    if (
      typeof result !== "number" ||
      !Number.isFinite(result)
    ) {
      throw new Error("Invalid calculation result.");
    }

    return {
      success: true,
      result
    };

  } catch (error) {

    return {
      success: false,
      error: "Calculation failed."
    };
  }
}


/* ------------------------------------------------------
   CURRENT TIME
------------------------------------------------------ */

function getCurrentTime() {

  const now = new Date();

  return {
    success: true,
    iso: now.toISOString(),
    timestamp: now.getTime(),
    date: now.toLocaleDateString("en-BD"),
    time: now.toLocaleTimeString("en-BD")
  };
}


/* ------------------------------------------------------
   FIREBASE STATUS
------------------------------------------------------ */

function firebaseStatus() {

  return {
    configured: isRealtimeDatabaseConfigured(),
    root: DB_ROOT
  };
}


/* ------------------------------------------------------
   BUSINESS SUMMARY
------------------------------------------------------ */

async function businessSummary() {

  const data = await readDatabase(
    `${DB_ROOT}/business`
  );

  return {
    success: true,
    source: "Firebase Realtime Database",
    path: `/${DB_ROOT}/business`,
    data: data || {},
    message: data
      ? "Business data retrieved successfully."
      : "No business data is currently available."
  };
}


/* ------------------------------------------------------
   STOCK SUMMARY
------------------------------------------------------ */

async function stockSummary() {

  const data = await readDatabase(
    `${DB_ROOT}/stock`
  );

  return {
    success: true,
    source: "Firebase Realtime Database",
    path: `/${DB_ROOT}/stock`,
    data: data || {},
    message: data
      ? "Stock data retrieved successfully."
      : "No stock data is currently available."
  };
}


/* ------------------------------------------------------
   LEDGER SUMMARY
------------------------------------------------------ */

async function ledgerSummary() {

  const data = await readDatabase(
    `${DB_ROOT}/ledger`
  );

  return {
    success: true,
    source: "Firebase Realtime Database",
    path: `/${DB_ROOT}/ledger`,
    data: data || {},
    message: data
      ? "Ledger data retrieved successfully."
      : "No ledger data is currently available."
  };
}


/* ------------------------------------------------------
   CUSTOMER SEARCH
------------------------------------------------------ */

async function customerSearch(query) {

  if (
    typeof query !== "string" ||
    !query.trim()
  ) {
    return {
      success: false,
      error: "Customer search query is required."
    };
  }

  const data = await readDatabase(
    `${DB_ROOT}/customers`
  );

  if (!data) {

    return {
      success: true,
      results: [],
      message: "No customer data found."
    };
  }

  const search = query
    .trim()
    .toLowerCase();

  const results = [];

  for (const [id, customer] of Object.entries(data)) {

    const text = JSON.stringify(customer)
      .toLowerCase();

    if (
      id.toLowerCase().includes(search) ||
      text.includes(search)
    ) {

      results.push({
        id,
        ...(
          typeof customer === "object"
            ? customer
            : { value: customer }
        )
      });
    }
  }

  return {
    success: true,
    query,
    results,
    count: results.length
  };
}


/* ------------------------------------------------------
   PRODUCT SEARCH
------------------------------------------------------ */

async function productSearch(query) {

  if (
    typeof query !== "string" ||
    !query.trim()
  ) {
    return {
      success: false,
      error: "Product search query is required."
    };
  }

  const data = await readDatabase(
    `${DB_ROOT}/products`
  );

  if (!data) {

    return {
      success: true,
      results: [],
      message: "No product data found."
    };
  }

  const search = query
    .trim()
    .toLowerCase();

  const results = [];

  for (const [id, product] of Object.entries(data)) {

    const text = JSON.stringify(product)
      .toLowerCase();

    if (
      id.toLowerCase().includes(search) ||
      text.includes(search)
    ) {

      results.push({
        id,
        ...(
          typeof product === "object"
            ? product
            : { value: product }
        )
      });
    }
  }

  return {
    success: true,
    query,
    results,
    count: results.length
  };
}


/* ------------------------------------------------------
   READ NIVORA ROOT
------------------------------------------------------ */

async function getNivoraData() {

  const data = await readDatabase(DB_ROOT);

  return {
    success: true,
    path: `/${DB_ROOT}`,
    data: data || {}
  };
}


/* ------------------------------------------------------
   WRITE NIVORA DATA
------------------------------------------------------ */

async function saveNivoraData(path, data) {

  if (
    typeof path !== "string" ||
    !path.trim()
  ) {
    throw new Error("Firebase path is required.");
  }

  /*
   Never allow the tool to escape /nivora.
  */
  const cleanPath = path
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");

  if (
    cleanPath === ".." ||
    cleanPath.includes("../") ||
    cleanPath.includes("..\\")
  ) {
    throw new Error("Invalid Firebase path.");
  }

  const finalPath =
    cleanPath.startsWith(DB_ROOT + "/") ||
    cleanPath === DB_ROOT
      ? cleanPath
      : `${DB_ROOT}/${cleanPath}`;

  return await writeDatabase(
    finalPath,
    data
  );
}


/* ------------------------------------------------------
   TOOL EXECUTOR
------------------------------------------------------ */

async function executeTool(
  toolName,
  args = {}
) {

  switch (toolName) {

    case "calculator":
      return calculator(args.expression);

    case "get_current_time":
      return getCurrentTime();

    case "business_summary":
      return await businessSummary();

    case "stock_summary":
      return await stockSummary();

    case "ledger_summary":
      return await ledgerSummary();

    case "customer_search":
      return await customerSearch(args.query);

    case "product_search":
      return await productSearch(args.query);

    case "firebase_status":
      return firebaseStatus();

    case "get_nivora_data":
      return await getNivoraData();

    default:
      throw new Error(
        `Unknown NIVORA AI tool: ${toolName}`
      );
  }
}


/* ------------------------------------------------------
   PUBLIC API
------------------------------------------------------ */

function getToolDefinitions() {
  return TOOL_DEFINITIONS;
}

function hasTool(name) {
  return TOOL_DEFINITIONS.some(
    tool => tool.name === name
  );
}


/* ------------------------------------------------------
   EXPORTS
------------------------------------------------------ */

module.exports = {

  DB_ROOT,

  TOOL_DEFINITIONS,

  getToolDefinitions,

  hasTool,

  executeTool,

  calculator,

  getCurrentTime,

  businessSummary,

  stockSummary,

  ledgerSummary,

  customerSearch,

  productSearch,

  getNivoraData,

  saveNivoraData,

  firebaseStatus

};