import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';
import type { HACompositePlatform } from './platform.js';

/**
 * JW: VacuumAccessory wraps a robot vacuum exposed via the Home Assistant HomeKit
 * bridge. It registers a Switch service to start/stop the vacuum and a
 * BatteryService to report battery level. Characteristic handlers proxy
 * reads and writes through the platform's hap-controller client. The
 * characteristic identifiers (aid.iid) for the On and BatteryLevel
 * characteristics are provided via the accessory context at registration.
 */
export class VacuumAccessory {
  private switchService: Service;
  private batteryService: Service;

  // Cached state to avoid unnecessary network calls
  private lastOnState = false;
  private lastBatteryLevel = 100;

  constructor(
    private readonly platform: HACompositePlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    // Set basic accessory information. Real values could be pulled from the
    // remote accessory metadata if desired.
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Home Assistant')
      .setCharacteristic(this.platform.Characteristic.Model, 'Robot Vacuum')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, String(accessory.context.accessoryAid));

    // Create or retrieve the Switch service
    this.switchService = this.accessory.getService(this.platform.Service.Switch)
      || this.accessory.addService(this.platform.Service.Switch);
    this.switchService.setCharacteristic(this.platform.Characteristic.Name, 'Vacuum');
    this.switchService.getCharacteristic(this.platform.Characteristic.On)
      .onSet(this.setOn.bind(this))
      .onGet(this.getOn.bind(this));

    // Create or retrieve the Battery service
    this.batteryService = this.accessory.getService(this.platform.Service.BatteryService)
      || this.accessory.addService(this.platform.Service.BatteryService);
    this.batteryService.getCharacteristic(this.platform.Characteristic.BatteryLevel)
      .onGet(this.getBatteryLevel.bind(this));
  }

  /**
   * JW: Turn the vacuum on or off. When called via HomeKit this method
   * proxies the request to the remote accessory using hap-controller.
   */
  async setOn(value: CharacteristicValue) {
    const boolValue = value as boolean;
    this.platform.log.info('Setting vacuum power state to', boolValue);
    this.lastOnState = boolValue;

    try {
      const { accessoryAid, onCharacteristic } = this.accessory.context as any;
      if (!accessoryAid || !onCharacteristic) {
        this.platform.log.warn('On characteristic identifiers not configured for this accessory');
        return;
      }
      if (!this.platform['httpClient']) {
        this.platform.log.warn('HTTP client not initialised; cannot proxy command');
        return;
      }
      const target = {} as any;
      target[`${accessoryAid}.${onCharacteristic}`] = boolValue;
      await (this.platform as any)['httpClient'].setCharacteristics(target);
    } catch (error) {
      this.platform.log.error('Failed to set vacuum power state:', error);
    }
  }

  /**
   * JW: Return the last known On state. A future enhancement could fetch
   * the current state from the remote accessory via getCharacteristics().
   */
  async getOn(): Promise<CharacteristicValue> {
    return this.lastOnState;
  }

  /**
   * JW: Fetch the battery level from the remote accessory. This method reads
   * the BatteryLevel characteristic using hap-controller. If the HTTP client
   * or characteristic identifiers are unavailable, returns the cached value.
   */
  async getBatteryLevel(): Promise<CharacteristicValue> {
    try {
      const { accessoryAid, batteryCharacteristic } = this.accessory.context as any;
      if (!accessoryAid || !batteryCharacteristic) {
        this.platform.log.warn('Battery characteristic identifiers not configured for this accessory');
        return this.lastBatteryLevel;
      }
      if (!this.platform['httpClient']) {
        this.platform.log.warn('HTTP client not initialised; returning cached battery level');
        return this.lastBatteryLevel;
      }
      const characteristics = await (this.platform as any)['httpClient'].getCharacteristics([`${accessoryAid}.${batteryCharacteristic}`]);
      const value = characteristics[0]?.value;
      if (typeof value === 'number') {
        this.lastBatteryLevel = value;
      }
    } catch (error) {
      this.platform.log.error('Failed to read battery level:', error);
    }
    return this.lastBatteryLevel;
  }
}