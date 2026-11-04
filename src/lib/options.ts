/** Reads "key: value" lines from a code block. Keys are lower-cased. */
export function parseOptions(source: string): Record<string, string> {
	const options: Record<string, string> = {};
	for (const line of source.split("\n")) {
		const match = line.match(/^\s*([\w-]+)\s*:\s*(.*?)\s*$/);
		if (match) options[match[1].toLowerCase()] = match[2];
	}
	return options;
}

export function isOff(value: string | undefined): boolean {
	return value !== undefined && /^(off|false|no|0)$/i.test(value);
}

export function isOn(value: string | undefined): boolean {
	return value !== undefined && /^(on|true|yes|1)$/i.test(value);
}
