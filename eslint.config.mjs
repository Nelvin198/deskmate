import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
	{ ignores: ["main.js", "node_modules/**", "esbuild.config.mjs", "example/**"] },
	...obsidianmd.configs.recommended,
	{
		languageOptions: {
			parserOptions: {
				projectService: { allowDefaultProject: ["eslint.config.mjs"] },
			},
		},
		rules: {
			// The declarative settings API (getSettingDefinitions) is Obsidian 1.13.0+. Our
			// minAppVersion is 1.9.0, so we keep the imperative display() to support 1.9–1.12.
			// Revisit if the floor is raised to 1.13.
			"obsidianmd/settings-tab/prefer-setting-definitions": "off",
		},
	},
]);
