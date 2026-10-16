import Constants from 'expo-constants';

/** Dev-only routes and lines (debug seed link, DB probe, engine self-test). Off in preview/production builds. */
export const DEBUG_ENABLED = __DEV__ && Constants.expoConfig?.extra?.appVariant === 'development';
