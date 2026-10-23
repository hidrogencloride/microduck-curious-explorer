"""Contract tests use an explicitly fake Unix server, never a real duck."""

import copy
import http.client
import json
from pathlib import Path
import socket
import tempfile
import threading
import time
import unittest

from explorer.bridge import API_VERSION, BridgeError, ExplorerBridge, make_server


class FakeRobot:
    def __init__(self, directory):
        self.path = str(Path(directory) / "duck.sock")
        self.config_path = Path(directory) / "robotd.toml"
        self.original_config = b'# Owner settings\n[policy]\nwalk = "custom-walk.onnx"\n\n[pad]\na = "polite-bow"\n'
        self.config_path.write_bytes(self.original_config)
        self.policies = {"mode": "walk", "enabled": True, "slots": [
            {"slot": "walk", "path": "custom-walk.onnx", "origin": "community"}], "skills": ["polite-bow"]}
        self.skills = {"skills": [{"name": "polite-bow", "path": "owner/bow.onnx", "duration": .2}], "built_in": ["sit_toggle"]}
        self.state = {"policy": "stand", "safety": {"fallen": False, "limp": False, "picked_up": False}}
        self.api_version = API_VERSION
        self.stream = True
        self.refuse = None
        self.messages = []
        self.closed = threading.Event()
        self.socket = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.socket.bind(self.path)
        self.socket.listen()
        self.socket.settimeout(.1)
        self.clients = []
        self.worker = threading.Thread(target=self._accept, daemon=True)
        self.worker.start()

    def _accept(self):
        while not self.closed.is_set():
            try:
                client, _ = self.socket.accept()
            except socket.timeout:
                continue
            except OSError:
                break
            self.clients.append(client)
            threading.Thread(target=self._serve, args=(client,), daemon=True).start()

    def _serve(self, client):
        subscribed = False
        data = b""
        client.settimeout(.05)
        try:
            while not self.closed.is_set():
                try:
                    chunk = client.recv(65536)
                    if not chunk:
                        break
                    data += chunk
                except socket.timeout:
                    pass
                while b"\n" in data:
                    line, data = data.split(b"\n", 1)
                    request = json.loads(line)
                    self.messages.append(request)
                    method = request["method"]
                    if "id" not in request:
                        continue
                    if method == "hello":
                        result = {"api_version": self.api_version, "daemon_version": "0.1.0", "revision": "fixture"}
                    elif method == "robot.skills":
                        result = self.skills
                    elif method == "robot.policies":
                        result = self.policies
                    elif method == "robot.health":
                        result = {"healthy": True}
                    elif method == "robot.subscribe":
                        subscribed = True
                        result = {"accepted": True}
                    elif method == "robot.look":
                        result = {"head": {"neck_pitch": 0, "head_pitch": .1, "head_yaw": .2, "head_roll": 0}, "clamped": False}
                    elif method == self.refuse:
                        result = {"accepted": False, "reason": "Fixture refusal: already occupied."}
                    else:
                        result = {"accepted": True}
                    client.sendall(json.dumps({"jsonrpc": "2.0", "id": request["id"], "result": result}).encode() + b"\n")
                if subscribed and self.stream:
                    client.sendall(json.dumps({"jsonrpc": "2.0", "method": "robot.state", "params": self.state}).encode() + b"\n")
        except OSError:
            pass
        finally:
            client.close()

    def close(self):
        self.closed.set()
        self.socket.close()
        for client in self.clients:
            try:
                client.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
        self.worker.join(timeout=1)


class BridgeTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="explorer-", dir="/tmp")
        self.robot = FakeRobot(self.directory.name)
        self.bridge = ExplorerBridge(self.robot.path, simulator=True, lease_seconds=1)
        self.bridge.status()
        deadline = time.monotonic() + 1
        while not self.bridge.rpc.state and time.monotonic() < deadline:
            time.sleep(.01)

    def tearDown(self):
        self.bridge.close()
        self.robot.close()
        self.directory.cleanup()

    def arm(self):
        return self.bridge.arm(True, exclusive=True)

    def test_connect_is_read_only_and_preserves_owner_setup(self):
        before = copy.deepcopy(self.robot.policies)
        status = self.bridge.status()
        self.assertTrue(status["connected"])
        self.assertFalse(status["armed"])
        self.assertFalse(status["simulation_verified"])
        self.assertEqual(status["policies"]["slots"][0]["path"], "custom-walk.onnx")
        self.arm()
        self.bridge.permissions(["polite-bow"])
        self.bridge.action({"kind": "skill", "skillId": "polite-bow"})
        self.bridge.pause()
        self.assertEqual(before, self.robot.policies)
        self.assertEqual(self.robot.config_path.read_bytes(), self.robot.original_config)
        methods = {m["method"] for m in self.robot.messages}
        self.assertLessEqual(methods, {"hello", "robot.subscribe", "robot.skills", "robot.policies", "robot.health", "robot.do", "robot.stop"})

    def test_arm_requires_exclusive_confirmation(self):
        with self.assertRaises(BridgeError):
            self.bridge.arm(True)
        self.assertFalse(self.bridge.armed)

    def test_unknown_endpoint_cannot_arm(self):
        self.bridge.simulator = False
        with self.assertRaises(BridgeError):
            self.arm()
        self.assertFalse(self.bridge.armed)

    def test_future_api_is_read_only(self):
        self.bridge.protocol["api_version"] = 999
        with self.assertRaises(BridgeError):
            self.arm()

    def test_skill_requires_permission_and_known_duration(self):
        self.arm()
        with self.assertRaises(BridgeError):
            self.bridge.action({"kind": "skill", "skillId": "polite-bow"})
        with self.assertRaises(BridgeError):
            self.bridge.permissions(["invented-skill"])
        self.bridge.permissions(["sit_toggle"])
        with self.assertRaises(BridgeError):
            self.bridge.action({"kind": "skill", "skillId": "sit_toggle"})
        self.assertFalse(any(m["method"] == "robot.do" for m in self.robot.messages))

    def test_daemon_refusal_is_not_reported_as_success(self):
        self.arm()
        self.robot.refuse = "robot.do"
        self.bridge.permissions(["polite-bow"])
        with self.assertRaisesRegex(BridgeError, "Fixture refusal"):
            self.bridge.action({"kind": "skill", "skillId": "polite-bow"})
        self.assertFalse(self.bridge.status()["busy"])

    def test_only_one_action_runs_at_a_time(self):
        self.arm()
        self.bridge.action({"kind": "look", "yaw": .1, "pitch": .1, "duration": .5})
        with self.assertRaisesRegex(BridgeError, "previous action"):
            self.bridge.action({"kind": "sound", "name": "curious-chirp"})

    def test_invalid_numeric_actions_never_reach_robot(self):
        self.arm()
        for value in [float("nan"), float("inf"), 7, True, "fast"]:
            with self.assertRaises(BridgeError):
                self.bridge.action({"kind": "move", "speed": value})
        self.assertFalse(any(m["method"] == "robot.move" for m in self.robot.messages))

    def test_deadman_stops_pulses_and_sends_stop_once(self):
        self.bridge.lease_seconds = .18
        self.arm()
        self.bridge.action({"kind": "move", "speed": .04, "duration": .8})
        time.sleep(.4)
        self.assertFalse(self.bridge.armed)
        before = len([m for m in self.robot.messages if m["method"] == "robot.move"])
        self.bridge.pause()
        time.sleep(.15)
        after = len([m for m in self.robot.messages if m["method"] == "robot.move"])
        self.assertEqual(before, after)
        self.assertEqual(len([m for m in self.robot.messages if m["method"] == "robot.stop"]), 1)

    def test_move_duration_stops_without_disarming_session(self):
        self.arm()
        self.bridge.action({"kind": "move", "speed": .04, "duration": .1})
        time.sleep(.25)
        self.assertTrue(self.bridge.armed)
        self.assertEqual(len([m for m in self.robot.messages if m["method"] == "robot.stop"]), 1)

    def test_attention_stop_releases_movement_and_keeps_session(self):
        self.arm()
        self.bridge.action({"kind": "move", "speed": .04, "duration": 1.4})
        self.bridge.action({"kind": "stop", "reason": "attention"})
        self.assertTrue(self.bridge.armed)
        self.assertIsNone(self.bridge.pulse)
        self.bridge.action({"kind": "look", "yaw": .6, "duration": .1})

    def test_attention_stop_does_not_overlap_running_skill(self):
        self.arm()
        self.bridge.permissions(["polite-bow"])
        self.bridge.action({"kind": "skill", "skillId": "polite-bow"})
        self.bridge.action({"kind": "stop", "reason": "attention"})
        with self.assertRaisesRegex(BridgeError, "previous action"):
            self.bridge.action({"kind": "look", "yaw": .1})

    def test_pause_and_rearm_preserve_active_skill_deadline(self):
        self.arm()
        self.bridge.permissions(["polite-bow"])
        self.bridge.action({"kind": "skill", "skillId": "polite-bow"})
        deadline = self.bridge.busy_until
        self.bridge.pause()
        self.arm()
        self.assertEqual(self.bridge.busy_until, deadline)
        with self.assertRaisesRegex(BridgeError, "previous action"):
            self.bridge.action({"kind": "look", "yaw": .1})

    def test_fallen_state_pauses_session(self):
        self.arm()
        self.robot.state["safety"]["fallen"] = True
        time.sleep(.2)
        self.assertFalse(self.bridge.armed)

    def test_unknown_sound_is_refused(self):
        self.arm()
        with self.assertRaises(BridgeError):
            self.bridge.action({"kind": "sound", "name": "mystery"})
        self.assertFalse(any(m["method"] == "robot.sound" for m in self.robot.messages))

    def test_disconnected_api_never_connects_or_arms(self):
        preview = ExplorerBridge()
        try:
            self.assertEqual(preview.status()["backend"], "disconnected")
            self.assertFalse(preview.status()["connected"])
            with self.assertRaises(BridgeError):
                preview.arm(True, exclusive=True)
        finally:
            preview.close()


class HttpBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.bridge = ExplorerBridge()
        self.server = make_server(self.bridge, port=0)
        self.port = self.server.server_address[1]
        self.worker = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.worker.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.bridge.close()
        self.worker.join(timeout=1)

    def request(self, method="POST", route="/api/pause", headers=None, body="{}"):
        client = http.client.HTTPConnection("127.0.0.1", self.port)
        try:
            client.request(method, route, body, headers or {})
            result = client.getresponse()
            return result.status, json.loads(result.read())
        finally:
            client.close()

    def test_browser_demo_routes_are_not_served(self):
        for route in ("/", "/index.html", "/guide.html", "/src/engine.js"):
            status, response = self.request(method="GET", route=route)
            self.assertEqual(status, 404)
            self.assertIn("no web interface", response["error"])

    def test_missing_token_is_refused(self):
        status, _ = self.request(headers={"Content-Type": "application/json"})
        self.assertEqual(status, 403)

    def test_foreign_origin_is_refused_even_with_token(self):
        status, _ = self.request(headers={"Content-Type": "application/json", "X-Explorer-Token": self.bridge.csrf_token, "Origin": "https://unrelated.example"})
        self.assertEqual(status, 403)

    def test_dns_rebinding_host_is_refused(self):
        status, _ = self.request(method="GET", route="/api/status", headers={"Host": "unrelated.example"})
        self.assertEqual(status, 403)

    def test_same_origin_request_succeeds(self):
        status, response = self.request(headers={"Content-Type": "application/json", "X-Explorer-Token": self.bridge.csrf_token, "Origin": f"http://127.0.0.1:{self.port}"})
        self.assertEqual(status, 200)
        self.assertTrue(response["accepted"])

    def test_status_returns_session_token_and_no_invented_robot(self):
        status, response = self.request(method="GET", route="/api/status")
        self.assertEqual(status, 200)
        self.assertEqual(response["csrfToken"], self.bridge.csrf_token)
        self.assertFalse(response["connected"])
        self.assertEqual(response["skills"], [])


if __name__ == "__main__":
    unittest.main()
