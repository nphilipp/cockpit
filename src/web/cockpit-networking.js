/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2013 Red Hat, Inc.
 *
 * Cockpit is free software; you can redistribute it and/or modify it
 * under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation; either version 2.1 of the License, or
 * (at your option) any later version.
 *
 * Cockpit is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with Cockpit; If not, see <http://www.gnu.org/licenses/>.
 */

/* HACK
 *
 * NetworkManager interfaces have their own PropertiesChanged signals,
 * so we catch them here and tell the interfaces to update their
 * values.
 *
 * Unfortunatly, o.f.NM.Device doesn't have a PropertiesChanged
 * signal.  Instead, the specialized interfaces like
 * o.f.NM.Device.Wired do double duty: Their PropertiesChanged signals
 * contain change notifications for both themselves and the
 * o.f.NM.Device properties.
 *
 * We 'solve' this here by merging the properties of all interfaces
 * for a given object.
 *
 * https://bugzilla.gnome.org/show_bug.cgi?id=729826
 */

function NetworkManagerModel(address) {
    var self = this;

    var client = $cockpit.dbus(this.address,
                               { 'service': "org.freedesktop.NetworkManager",
                                 'object-paths': [ "/org/freedesktop/NetworkManager" ],
                                 'protocol': "dbus-json1"
                               });

    var objects = { };

    self.devices = [ ];

    function get_object(val) {
        if (val == "/")
            return null;
        else if (objects[val])
            return objects[val];
        else {
            console.log("ERROR", val, "undefined");
            return undefined;
        }
    }

    function toDec(n) {
        return n.toString(10);
    }

    function toHex(n) {
        var x = n.toString(16);
        while (x.length < 2)
            x = '0' + x;
        return x;
    }

    function net32_to_bytes(num) {
        var bytes = [], i;
        if (client.byteorder == "be") {
            for (i = 3; i >= 0; i--) {
                bytes[i] = num & 0xFF;
                num = num >>> 8;
            }
        } else {
            for (i = 0; i < 4; i++) {
                bytes[i] = num & 0xFF;
                num = num >>> 8;
            }
        }
        return bytes;
    }

    function translate_ip4_address(addr) {
        return [ net32_to_bytes(addr[0]).map(toDec).join('.'),
                 addr[1],
                 net32_to_bytes(addr[2]).map(toDec).join('.')
               ];
    }

    function translate_ip6_address(addr) {
        return [ addr[0].map(toHex).join(':'),
                 addr[1],
                 addr[2].map(toHex).join(':')
               ];
    }

    function device_state_to_text(state) {
        switch (state) {
            // NM_DEVICE_STATE_UNKNOWN
        case 0: return "?";
            // NM_DEVICE_STATE_UNMANAGED
            case 10: return "";
            // NM_DEVICE_STATE_UNAVAILABLE
        case 20: return _("Not available");
            // NM_DEVICE_STATE_DISCONNECTED
        case 30: return _("Disconnected");
            // NM_DEVICE_STATE_PREPARE
        case 40: return _("Preparing");
            // NM_DEVICE_STATE_CONFIG
        case 50: return _("Configuring");
            // NM_DEVICE_STATE_NEED_AUTH
        case 60: return _("Authenticating");
            // NM_DEVICE_STATE_IP_CONFIG
        case 70: return _("Configuring IP");
            // NM_DEVICE_STATE_IP_CHECK
        case 80: return _("Checking IP");
            // NM_DEVICE_STATE_SECONDARIES
        case 90: return _("Waiting");
            // NM_DEVICE_STATE_ACTIVATED
        case 100: return _("Active");
            // NM_DEVICE_STATE_DEACTIVATING
        case 110: return _("Deactivating");
            // NM_DEVICE_STATE_FAILED
        case 120: return _("Failed");
        default: return "";
        }
    }

    function model_properties_changed (path, iface, props) {
        var obj = objects[path];
        if (!obj)
            obj = { };
        if (iface == "org.freedesktop.NetworkManager") {
            if (props.Devices)    obj.Devices = (props.Devices || []).map(get_object);
        } else if (iface == "org.freedesktop.NetworkManager.Device" ||
                   iface.startsWith("org.freedesktop.NetworkManager.Device.")) {
            if (props.DeviceType) obj.DeviceType = props.DeviceType;
            if (props.Interface)  obj.Interface = props.Interface;
            if (props.Ip4Config)  obj.Ip4Config = get_object(props.Ip4Config);
            if (props.Ip6Config)  obj.Ip6Config = get_object(props.Ip6Config);
            if (props.State)      obj.State = device_state_to_text(props.State);
            if (props.HwAddress)  obj.HwAddress = props.HwAddress;
        } else if (iface == "org.freedesktop.NetworkManager.IP4Config") {
            if (props.Addresses)  obj.Addresses = props.Addresses.map(translate_ip4_address);
        } else if (iface == "org.freedesktop.NetworkManager.IP6Config") {
            if (props.Addresses)  obj.Addresses = props.Addresses.map(translate_ip6_address);
        }
        objects[path] = obj;
        export_model();
    }

    function model_removed (path) {
        delete objects[path];
    }

    var changed_pending;

    function export_model() {
        var manager = objects["/org/freedesktop/NetworkManager"];
        self.devices = (manager && manager.Devices) || [];

        if (!changed_pending) {
            changed_pending = true;
            setTimeout(function () { changed_pending = false; console.log(objects); $(self).trigger('changed'); }, 0);
        }
    }

    function refresh_all_devices() {
        var path;
        for (path in objects) {
            if (path.startsWith("/org/freedesktop/NetworkManager/Devices/")) {
                (function (path) {
                    var p = client.get(path, "org.freedesktop.DBus.Properties");
                    p.call('GetAll', "org.freedesktop.NetworkManager.Device",
                           function (error, result) {
                               if (!error) {
                                   model_properties_changed(path, "org.freedesktop.NetworkManager.Device", result);
                               }
                           });
                })(path);
            }
        }
    }

    function object_added (event, object) {
        for (var iface in object._ifaces)
            interface_added (event, object, object._ifaces[iface]);
    }

    function object_removed (event, object) {
        for (var iface in object._ifaces)
            interface_removed (event, object, object._ifaces[iface]);
    }

    function interface_added (event, object, iface) {
        var path = object.objectPath;
        model_properties_changed (path, iface._iface_name, iface);
    }

    function interface_removed (event, object, iface) {
        var path = object.objectPath;
        model_removed (path);
    }

    function signal_emitted (event, iface, signal, args) {
        if (signal == "PropertiesChanged") {
            var path = iface.getObject().objectPath;
            model_properties_changed (path, iface._iface_name, args[0]);
        } else if (signal == "Updated") {
            /* HACK
             *
             * Some versions of NetworkManager don't always send
             * PropertyChanged notifications about the
             * o.f.NM.Device.Ip4Config property.
             *
             * https://bugzilla.gnome.org/show_bug.cgi?id=729828
             */
            refresh_all_devices();
        }
    }

    $(client).on("objectAdded", object_added);
    $(client).on("objectRemoved", object_removed);
    $(client).on("interfaceAdded", interface_added);
    $(client).on("interfaceRemoved", interface_removed);
    $(client).on("signalEmitted", signal_emitted);

    self.destroy = function destroy() {
        $(client).off("objectAdded", object_added);
        $(client).off("objectRemoved", object_removed);
        $(client).off("interfaceAdded", interface_added);
        $(client).off("interfaceRemoved", interface_removed);
        $(client).off("signalEmitted", signal_emitted);
        client.release();
    };

    client.getObjectsFrom("/").forEach(function (obj) { object_added (null, obj); });

    return self;
}

PageNetworking.prototype = {
    _init: function () {
        this.id = "networking";
    },

    getTitle: function() {
        return C_("page-title", "Networking");
    },

    enter: function () {
        this.address = cockpit_get_page_param('machine', 'server') || "localhost";
        this.model = new NetworkManagerModel(this.address);
        $(this.model).on('changed.network-interface', $.proxy(this, "update_devices"));
        this.update_devices();
    },

    show: function() {
    },

    leave: function() {
        $(this.model).off(".network-interface");
        this.model.destroy();
        this.model = null;
    },

    update_devices: function() {
        var self = this;
        var tbody;

        tbody = $('#networking-interfaces tbody');
        tbody.empty();
        self.model.devices.forEach(function (dev) {
            if (!dev)
                return;

            // Skip loopback
            if (dev.DeviceType == 14)
                return;

            var addresses = [ ];

            var ip4config = dev.Ip4Config;
            if (ip4config && ip4config.Addresses) {
                ip4config.Addresses.forEach(function (a) {
                    addresses.push(a[0] + "/" + a[1]);
                });
            }

            var ip6config = dev.Ip6Config;
            if (ip6config && ip6config.Addresses) {
                ip6config.Addresses.forEach(function (a) {
                    addresses.push(a[0] + "/" + a[1]);
                });
            }

            tbody.append(
                $('<tr>').append(
                    $('<td>').text(dev.Interface),
                    $('<td>').text(addresses.join(", ")),
                    $('<td>').text(dev.HwAddress),
                    $('<td>').text(dev.State)));
        });
    }

};

function PageNetworking() {
    this._init();
}

cockpit_pages.push(new PageNetworking());
