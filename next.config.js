/** @type {import('next').NextConfig} */
const nextConfig = {
	webpack(config, options) {

		/* SVG file */
		// Grab the existing rule that handles SVG imports
		const fileLoaderRule = config.module.rules.find((rule) =>
			rule.test?.test?.('.svg'),
		)

		config.module.rules.push(
			// Reapply the existing rule, but only for svg imports ending in ?url
			{
				...fileLoaderRule,
				test: /\.svg$/i,
				resourceQuery: /url/, // *.svg?url
			},
			// Convert all other *.svg imports to React components
			{
				test: /\.svg$/i,
				issuer: fileLoaderRule.issuer,
				resourceQuery: {
					not: [...fileLoaderRule.resourceQuery.not, /url/]
				}, // exclude if *.svg?url
				use: ['@svgr/webpack'],
			},
		)

		// Modify the file loader rule to ignore *.svg, since we have it handled now.
		fileLoaderRule.exclude = /\.svg$/i

		/* Node.js loader*/
		if (!options.isServer) {
			config.externals = config.externals.map((external) => {
			  if (typeof external !== 'function') return external;
			  return (ctx, req, cb) => (req.startsWith('dockerode') ? cb() : external(ctx, req, cb));
			});
		  }
	  
		  config.module.rules.push({
			test: /\.node$/,
			loader: 'node-loader',
		  });

		return config
	},
};

module.exports = nextConfig;