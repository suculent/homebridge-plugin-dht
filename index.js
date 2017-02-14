/*
 * This HAP device connects to defined or default mqtt broker/channel and creates a temperature service(s).
 */


var Service, Characteristic, Accessory;

// should go from config
var default_broker_address = 'mqtt://localhost'
var default_mqtt_channel = "/sht/2"

'use strict';

var querystring = require('querystring');
var http = require('http');
var mqtt = require('mqtt');

const uuidV1 = require('uuid/v1');

var mqttClient = null; // will be non-null if working

module.exports = function(homebridge) {
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;
    Accessory = homebridge.hap.Accessory;
    
    // ??
    homebridge.registerAccessory("homebridge-dht", "TempSensor", TempSensor);
}

function TempSensor(log, config) {

  this.log = log;

  this.name = config['name'] || "DHT Sensor";
  this.mqttBroker = config['mqtt_broker'];
  this.mqttChannel = config['mqtt_channel'];
  this.shortIdentifier = config['device_identifier'];   
  this.temperature = 0;
  this.humidity = 0; 

  this.elk_host = config['elk_host'];
  this.elk_port = config['elk_port'];
  this.elk_index = config['elk_index'];

  // Should use something from device identifier to lock UUIDs
  var nsecs = parseInt(this.shortIdentifier.substring(5, this.shortIdentifier.length))
  var sensorUUID = uuidV1({
    node: [0x01, 0x23, 0x45, 0x67, 0x89, 0xab],
    clockseq: 0x1234,
    msecs: new Date('1980-10-15').getTime(),
    nsecs: nsecs
  });

  this.sensor = exports.accessory = new Accessory('TempSensor', sensorUUID);

  this.temperatureService = this.sensor.addService(Service.TemperatureSensor)
  this.temperatureService
  .getCharacteristic(Characteristic.CurrentTemperature)
  .on('get', function(callback) {
    console.log("Get T:"+this.temperature);
    callback(null, this.temperature);
  });

  this.humidityService = this.sensor.addService(Service.HumiditySensor)
  this.humidityService  
  .getCharacteristic(Characteristic.CurrentRelativeHumidity)
  .on('get', function(callback) {    
    console.log("Get H:"+this.humidity);
    callback(null, this.humidity);
  });

  // randomize our temperature reading every 3 seconds
  setInterval(function(a) {

    a.log("Timer Update > " + a.temperature + "°C " + a.humidity + "%");
    
    a.sensor
      .getService(Service.TemperatureSensor)
      .setCharacteristic(Characteristic.CurrentTemperature, a.temperature);

    a.sensor
      .getService(Service.HumiditySensor)
      .setCharacteristic(Characteristic.CurrentRelativeHumidity, a.humidity);
    
  }, 10000, this);  

  this.getServices(this);

  if (!this.mqttBroker) {
      this.log.warn('Config is missing mqtt_broker, fallback to default.');        
      this.mqttBroker = default_broker_address;
      if (!this.mqttBroker.contains("mqtt://")) {
          this.mqttBroker = "mqtt://" + this.mqttBroker;
      }
  }

  if (!this.mqttChannel) {
      this.log.warn('Config is missing mqtt_channel, fallback to default.');
      this.mqttChannel = default_mqtt_channel;        
  }

  init_mqtt(this.mqttBroker, this.mqttChannel, this.temperatureService, this.humidityService, log, this.sensor, this);

  /* Sends a JSON message to Elasticsearch database */
  function elk(json_message, host, port, index)
  {
    var http = require('http');

    var options = {
      host: host,
      port: port,
      path: index,
      method: 'POST'
    };

    function callback(response) {
      var str = ''
      response.on('data', function (chunk) {
        str += chunk;
      });

      response.on('end', function () {
        console.log(str);
      });
    };

    var elk = http.request(options, callback);
    var data = JSON.stringify(json_message);
    console.log(data);
    elk.write(data);
    elk.end();
  }

  function init_mqtt(broker_address, channel, ts, hs, log, sensor, a) {
    log("Connecting to mqtt broker: " + broker_address + " channel: "+channel)
    mqttClient = mqtt.connect(broker_address)

    mqttClient.on('connect', function () {
      log("MQTT connected, subscribing to: " + channel)
      mqttClient.subscribe(channel)
    })

    mqttClient.on('error', function () {
      log("MQTT connected, subscribing to: " + channel)
      mqttClient.subscribe(channel)
    })

    mqttClient.on('offline', function () {
      log("MQTT connected, subscribing to: " + channel)
      mqttClient.subscribe(channel)
    })  

    var that = a;
    
    mqttClient.on('message', function (topic, message) {
      
      a.log("t-message: " + message.toString())

      a.log("MQTT get 0 >");
      
      if (topic == channel) {

        console.log("MQTT get 1 >");

        if (this.shortIdentifier == message.shortIdentifier) {
          
          var m = JSON.parse(message)
          m.timestamp = new Date();          

          // because elasticsearch does not like '-'' in identifiers
          m.shortIdentifier = m.shortIdentifier.replace('-', '_');

          var t = m.temperature;
          var h = m.humidity;

          that.temperature = t;
          that.humidity = h;

          that.sensor
            .getService(Service.TemperatureSensor)
            .setCharacteristic(Characteristic.CurrentTemperature, that.temperature);

          that.sensor
            .getService(Service.HumiditySensor)
            .setCharacteristic(Characteristic.CurrentRelativeHumidity, that.humidity);

          console.log("[processing] " + channel + " to " + message)

          elk(m, a.host, a.port, a.index)

        } else {
          a.log("Message for different shortIdentifier: "+message.shortIdentifier)
        }
      }

    })
  }

} // end class

TempSensor.prototype.getTemperature = function(callback) {
    this.log('getTemperature callback(null, '+this.temperature+')');
    callback(null, this.temperature);    
}

TempSensor.prototype.getHumidity = function(callback) {
    this.log('getHumidity callback(null, '+this.humidity+')');
    callback(null, this.humidity);
}

TempSensor.prototype.getServices = function() {

    var informationService = new Service.AccessoryInformation();

    informationService
      .setCharacteristic(Characteristic.Manufacturer, "Page 42")
      .setCharacteristic(Characteristic.Model, "Temperature Sensor")
      .setCharacteristic(Characteristic.SerialNumber, "4");

    return [this.temperatureService, this.humidityService, informationService];
}

process.on('uncaughtException', function(err) {
  console.log('Caught exception: ' + err);
});