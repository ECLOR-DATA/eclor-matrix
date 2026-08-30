/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "jsdom",
  rootDir: ".",
  roots: ["<rootDir>/src", "<rootDir>/test"],
  testRegex: "(/test/.*\\.test)\\.ts$",
  moduleFileExtensions: ["ts", "tsx", "js"],
  setupFiles: ["<rootDir>/test/_jest-setup.js"],
  moduleNameMapper: {
    "^powerbi-visuals-api$": "<rootDir>/test/_powerbi-stub.ts",
    "\\.(less|css|scss|sass)$": "<rootDir>/test/_style-stub.js"
  },
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { tsconfig: "<rootDir>/tsconfig.jest.json" }],
    "^.+\\.js$": ["ts-jest", { tsconfig: "<rootDir>/tsconfig.jest.json" }]
  },
  // formattingmodel + dataviewutils + formattingutils ship ESM-only — let
  // ts-jest transform them
  transformIgnorePatterns: [
    "/node_modules/(?!(powerbi-visuals-utils-formattingmodel|powerbi-visuals-utils-dataviewutils|powerbi-visuals-utils-formattingutils|powerbi-visuals-utils-typeutils)/)"
  ]
};
