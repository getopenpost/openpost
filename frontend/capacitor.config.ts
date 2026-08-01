import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
	appId: 'com.openpost.app',
	appName: 'OpenPost',
	webDir: '../backend/cmd/openpost/public',
	server: {
		androidScheme: 'https'
	},
	plugins: {
		SplashScreen: {
			launchShowDuration: 0
		},
		StatusBar: {
			style: 'default'
		},
		CapacitorHttp: {
			enabled: true
		}
	}
};

export default config;
