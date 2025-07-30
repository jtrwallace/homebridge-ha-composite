import type { API, Characteristic, DynamicPlatformPlugin, Logging, PlatformAccessory, PlatformConfig, Service } from 'homebridge';

import { ExamplePlatformAccessory } from './platformAccessory.js';
import { VacuumAccessory } from './vacuumAccessory.js';
// Import hap-controller as a CommonJS module and destructure the HttpClient class.
import hapController from 'hap-controller';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';

// This is only required when using Custom Services and Characteristics not support by HomeKit
import { EveHomeKitTypes } from 'homebridge-lib/EveHomeKitTypes';

/**
 * HomebridgePlatform
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */
export class HACompositePlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;

  // this is used to track restored cached accessories
  public readonly accessories: Map<string, PlatformAccessory> = new Map();
  public readonly discoveredCacheUUIDs: string[] = [];

  /**
   * JW: List of accessories returned from the HomeKit bridge. Populated in
   * connectToBridge() and used during discovery to find devices.
   */
  private bridgeAccessories: any[] = [];

  /**
   * JW: Client used to communicate with the HomeKit bridge via hap-controller.
   */
  private httpClient: any | undefined;

  // This is only required when using Custom Services and Characteristics not support by HomeKit
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public readonly CustomServices: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public readonly CustomCharacteristics: any;

  constructor(
    public readonly log: Logging,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;

    // This is only required when using Custom Services and Characteristics not support by HomeKit
    this.CustomServices = new EveHomeKitTypes(this.api).Services;
    this.CustomCharacteristics = new EveHomeKitTypes(this.api).Characteristics;

    this.log.debug('Finished initializing platform:', this.config.name);

    // When this event is fired it means Homebridge has restored all cached accessories from disk.
    // Dynamic Platform plugins should only register new accessories after this event was fired,
    // in order to ensure they weren't added to homebridge already. This event can also be used
    // to start discovery of new accessories.
    this.api.on('didFinishLaunching', () => {
      log.debug('Executed didFinishLaunching callback');
      // Attempt to connect to the HomeKit bridge using configuration details
      this.connectToBridge().then(() => {
        // once connected (or attempted), begin discovery of devices
        this.discoverDevices();
      }).catch((error: unknown) => {
        this.log.error('Error while connecting to HomeKit bridge:', error);
        this.discoverDevices();
      });
    });
  }

  /**
   * JW: Connect to the configured HomeKit bridge using hap-controller. Reads
   * controller configuration from the platform config (id, address, port, pairingData)
   * and constructs an HttpClient. If configuration is missing or invalid, logs
   * a warning and returns without throwing.
   */
  private async connectToBridge(): Promise<void> {
    const controllerConfig = this.config.controller as any;
    if (!controllerConfig) {
      this.log.warn('No controller configuration found for Home Assistant bridge.');
      return;
    }
    const { id, address, port, pairingData } = controllerConfig;
    if (!id || !address || !port || !pairingData) {
      this.log.warn('Incomplete controller configuration. Please specify id, address, port and pairingData.');
      return;
    }
    this.log.debug('Connecting to HomeKit bridge', id, address, port);
    try {
      const { HttpClient } = hapController as any;
      this.httpClient = new HttpClient(id, address, port, pairingData);
      const accessories: any[] = await this.httpClient.getAccessories();
      this.bridgeAccessories = accessories;
      this.log.info(`Retrieved ${accessories.length} accessories from bridge`);
    } catch (error) {
      this.log.error('Failed to connect or list accessories:', error);
    }
  }

  /**
   * This function is invoked when homebridge restores cached accessories from disk at startup.
   * It should be used to set up event handlers for characteristics and update respective values.
   */
  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);

    // add the restored accessory to the accessories cache, so we can track if it has already been registered
    this.accessories.set(accessory.UUID, accessory);
  }

  /**
   * This is an example method showing how to register discovered accessories.
   * Accessories must only be registered once, previously created accessories
   * must not be registered again to prevent "duplicate UUID" errors.
   */
  discoverDevices() {
    // Discover and register a single vacuum accessory by inspecting the accessory list
    // provided by the HomeKit bridge. We require the HTTP client and accessory list
    // to be available from the connectToBridge() call.
    if (!this.httpClient || this.bridgeAccessories.length === 0) {
      this.log.warn('No HomeKit bridge connection or accessories available; skipping discovery');
      return;
    }

    // Helper to check if a service UUID ends with a given short type code (e.g. '49' for Switch)
    const endsWithShort = (uuid: string, code: string) => uuid.endsWith(code) || uuid.endsWith(code.toUpperCase());

    // Find the first accessory that has both a Switch service and a Battery service
    let candidateAccessory: any | undefined;
    for (const accessory of this.bridgeAccessories) {
      const services = accessory.services || [];
      const hasSwitch = services.some((svc: any) => endsWithShort(svc.type, '49'));
      const hasBattery = services.some((svc: any) => endsWithShort(svc.type, '96'));
      if (hasSwitch && hasBattery) {
        candidateAccessory = accessory;
        break;
      }
    }
    if (!candidateAccessory) {
      this.log.warn('No suitable vacuum accessory found on the bridge');
      return;
    }
    const accessoryAid = candidateAccessory.aid;
    // Extract characteristic instance identifiers for On and BatteryLevel
    let onCharacteristic = undefined;
    let batteryCharacteristic = undefined;
    for (const svc of candidateAccessory.services) {
      if (endsWithShort(svc.type, '49')) {
        for (const ch of svc.characteristics) {
          if (endsWithShort(ch.type, '25')) {
            onCharacteristic = ch.iid;
          }
        }
      } else if (endsWithShort(svc.type, '96')) {
        for (const ch of svc.characteristics) {
          // Battery level characteristic ends with '68'
          if (endsWithShort(ch.type, '68')) {
            batteryCharacteristic = ch.iid;
          }
        }
      }
    }
    if (!onCharacteristic) {
      this.log.warn('Could not locate On characteristic for vacuum accessory');
    }
    if (!batteryCharacteristic) {
      this.log.warn('Could not locate BatteryLevel characteristic for vacuum accessory');
    }
    // Generate a UUID based on the accessory aid
    const uuid = this.api.hap.uuid.generate(String(accessoryAid));
    const existing = this.accessories.get(uuid);
    const displayName = candidateAccessory.services[0]?.name || 'Robot Vacuum';
    if (existing) {
      this.log.info('Restoring existing vacuum accessory from cache:', existing.displayName);
      // Update context with new identifiers
      existing.context.accessoryAid = accessoryAid;
      existing.context.onCharacteristic = onCharacteristic;
      existing.context.batteryCharacteristic = batteryCharacteristic;
      new VacuumAccessory(this, existing);
      this.api.updatePlatformAccessories([existing]);
    } else {
      this.log.info('Adding new vacuum accessory:', displayName);
      const accessory = new this.api.platformAccessory(displayName, uuid);
      accessory.context.accessoryAid = accessoryAid;
      accessory.context.onCharacteristic = onCharacteristic;
      accessory.context.batteryCharacteristic = batteryCharacteristic;
      new VacuumAccessory(this, accessory);
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      this.accessories.set(uuid, accessory);
    }
    this.discoveredCacheUUIDs.push(uuid);
    // Remove cached accessories no longer present
    for (const [id, acc] of this.accessories) {
      if (!this.discoveredCacheUUIDs.includes(id)) {
        this.log.info('Removing existing accessory from cache:', acc.displayName);
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [acc]);
        this.accessories.delete(id);
      }
    }
  }
}
