/**
 * JW: Discovers HomeKit bridges on the local network and optionally pairs to the
 * first matching bridge. This helper script is intended to be run outside of
 * Homebridge during development to discover your Home Assistant HomeKit
 * bridge and obtain its long‑term pairing data. You can then copy the
 * resulting JSON into the plugin configuration so the plugin can reconnect
 * without re‑pairing.
 *
 * Usage:
 *   ts-node src/discover.ts --pin 123-45-678 [--name "Home Assistant Bridge"]
 *
 * If no --pin is provided the script will only list discovered devices.
 */

// Import the default export from hap-controller and then destructure the classes we need.
import hapController from 'hap-controller';
const { IPDiscovery, HttpClient } = hapController;

/**
 * JW: Represents the parsed command line arguments supported by this script.
 * Supported flags:
 *  --pin / -p   The HomeKit PIN code used for pairing
 *  --name / -n  The name of the target device to automatically pair with
 */
interface CommandLineArguments {
  pinCode?: string;
  targetName?: string;
}

/**
 * JW: Parse the command line arguments passed to this script.
 * Looks for --pin / -p and --name / -n flags and captures their values.
 */
function parseCommandLineArguments(): CommandLineArguments {
  const commandLineArguments: CommandLineArguments = {};
  const rawArguments: string[] = process.argv.slice(2);
  for (let index = 0; index < rawArguments.length; index++) {
    const argument: string = rawArguments[index];
    switch (argument) {
      case '--pin':
      case '-p': {
        const value: string | undefined = rawArguments[index + 1];
        if (value) {
          commandLineArguments.pinCode = value;
          index++;
        }
        break;
      }
      case '--name':
      case '-n': {
        const value: string | undefined = rawArguments[index + 1];
        if (value) {
          commandLineArguments.targetName = value;
          index++;
        }
        break;
      }
      default:
        // Ignore unknown flags for now
        break;
    }
  }
  return commandLineArguments;
}

/**
 * JW: Entry point for the script. Performs discovery and optionally pairing.
 */
async function main(): Promise<void> {
  const commandLineArguments: CommandLineArguments = parseCommandLineArguments();
  // Create a discovery instance which listens for HomeKit accessories on the network
  // Create a discovery instance which listens for HomeKit accessories via IP
  const discovery: any = new IPDiscovery();
  console.log('Starting discovery…');
  discovery.on('serviceUp', async (discoveredService: any) => {
    // Log every discovered service
    console.log(`Discovered accessory: ${discoveredService.name} (${discoveredService.id}) at ${discoveredService.address}:${discoveredService.port}`);
    // If a target name is specified, check if this service matches
    if (commandLineArguments.targetName && discoveredService.name === commandLineArguments.targetName) {
      if (!commandLineArguments.pinCode) {
        console.warn('PIN code was not provided; skipping pairing.');
        return;
      }
      // Pair with the target device using the provided PIN code
      try {
        console.log(`Attempting to pair with ${discoveredService.name}…`);
        const client: any = new HttpClient(discoveredService.id, discoveredService.address, discoveredService.port);
        await client.pairSetup(commandLineArguments.pinCode);
        // Extract long‑term pairing data for persistent connections
        const longTermPairingData: unknown = client.getLongTermData();
        console.log('Pairing complete. Save the following JSON to your Homebridge config:');
        console.log(JSON.stringify(longTermPairingData, null, 2));
      } catch (error) {
        console.error(`Failed to pair with ${discoveredService.name}:`, error);
      }
      // Stop discovery once we've paired
      discovery.stop();
    }
  });
  discovery.start();
  // Stop discovery automatically after 30 seconds if no target is paired
  setTimeout(() => {
    discovery.stop();
    console.log('Discovery timed out.');
  }, 30000);
}

main().catch((error: unknown) => {
  console.error('An unexpected error occurred:', error);
});