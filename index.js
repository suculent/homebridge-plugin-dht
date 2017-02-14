/*
 * This HAP device connects to defined or default mqtt broker/channel and creates a temperature service(s).
 */


var Service, Characteristic;

// should go from config
var default_broker_address = 'mqtt://localhost'
var default_mqtt_channel = "/dht/0"

'use strict';

module.exports = function(homebridge) {
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;
    homebridge.registerAccessory("homebridge-dht", "TempSensor", TempSensor);
}

function TempSensor(log, config) {

  var querystring = require('querystring');
  var http = require('http');
  var mqtt = require('mqtt')

  this.log = log;
  this.name = config['name'] || "DHT Sensor";
  this.mqttBroker = config['mqtt_broker'];
  this.mqttChannel = config['mqtt_channel'] || default_mqtt_channel;
  this.shortIdentifier = config['device_identifier'];   
  this.temperature = 0;
  this.humidity = 0; 

  this.log("Registering service name " + this.name);
  
  this.temperatureService = new Service.TemperatureSensor(this.name, "temperature")
  this.temperatureService
    .getCharacteristic(Characteristic.CurrentTemperature)
    .on('get', this.getTemperature.bind(this))

  this.humidityService = new Service.HumiditySensor(this.name, "humidity")
  this.humidityService
    .getCharacteristic(Characteristic.CurrentRelativeHumidity)
    .on('get', this.getHumidity.bind(this))

  this.getServices();

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

  this.mqttClient = 0;

  init_mqtt(this.mqttBroker, this.mqttChannel, this.temperatureService, this.humidityService, this.mqttClient);

  /* Sends a JSON message to Elasticsearch database */
  function elk(json_message)
  {
    var http = require('http');

    var options = {
      host: 'mini.local',
      port: '9200',
      path: '/telemetry-1/status',
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
    elk.write(data);
    elk.end();
  }

  function init_mqtt(broker_address, channel, ts, hs, mq) {
    console.log("Connecting to mqtt broker: " + broker_address + " channel: "+channel);
    mq = mqtt.connect(broker_address);

    mq.on('connect', function () {
      console.log("MQTT connected, subscribing to: " + channel);
      this.mqttClient.subscribe(channel);
    })

    mq.on('error', function () {
      console.log("MQTT error.");
    })

    mq.on('offline', function () {
      console.log("MQTT offline");
    })  

    mq.on('message', function (topic, message) {

      console.log("topic: " + topic + " channel: " + channel);
      console.log("si: " + this.shortIdentifier);
      console.log("message: " + message.toString());
      
      if (topic == channel) {

      	console.log("msi: " + message.shortIdentifier);

	var m = JSON.parse(message);

        if (this.shortIdentifier == m.shortIdentifier) {

          m.timestamp = new Date();          

          var t = m.temperature;
          var h = m.humidity;

          this.temperature = t;
          this.humidity = h;

          ts
          .getCharacteristic(Characteristic.CurrentTemperature)
          .setValue(t);

          hs
          .getCharacteristic(Characteristic.CurrentRelativeHumidity)
          .setValue(h);

          console.log("[processing] " + channel + " to " + message);
          this.log("[processing] " + channel + " to " + message);

          elk(m)
        } else {
		console.log("shortIdentifier not equal" + this.shortIdentifier);
		this.log("shortIdentifier not equal" + this.shortIdentifier);
	}


      } else {
	this.log("topic not a channel");
	console.log("topic not a channel");
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
      .setCharacteristic(Characteristic.SerialNumber, "3");

    return [this.temperatureService, this.humidityService, informationService];
}

process.on('uncaughtException', function(err) {
  console.log('Caught exception: ' + err);
});
