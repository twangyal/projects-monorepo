import copy
import json
from pathlib import Path
import unittest
from verify_terminal_clock import analyze

ROOT = Path(__file__).parent
class TerminalReplayTests(unittest.TestCase):
    def setUp(self):
        self.rows = [json.loads((ROOT / 'receipts' / f'{i:02}.json').read_text()) for i in range(10)]
        self.controls = [json.loads((ROOT / 'receipts' / f'control-{rate}.json').read_text()) for rate in (44100,48000)]
    def test_original_passes_are_not_twenty_recording_successes(self):
        result = analyze(self.rows,self.controls)
        self.assertEqual((result['harnessPasses'],result['plannedStarts'],result['recordingPhases'],result['nativeRefusals']),(10,20,19,1))
        self.assertEqual(result['refusals'][0]['overlapFrames'],128)
    def test_missing_row_refuses(self):
        with self.assertRaises(ValueError): analyze(self.rows[:-1],self.controls)
    def terminal(self):
        return next(e for e in self.rows[1]['captured']['events'] if e['kind']=='terminal')
    def test_resigned_clock_that_would_not_refuse_is_rejected(self):
        data=self.terminal()['data'];data['receipt']['previousEnd']=data['receipt']['incomingStart']
        with self.assertRaises(ValueError): analyze(self.rows,self.controls)
    def test_prestart_captured_samples_are_rejected(self):
        self.terminal()['data']['receipt']['captured']=128
        with self.assertRaises(ValueError): analyze(self.rows,self.controls)
    def test_terminal_audio_payload_is_rejected(self):
        self.terminal()['data']['samples']=[0.1]
        with self.assertRaises(ValueError): analyze(self.rows,self.controls)
    def test_current_frame_and_receipt_disagreement_refuses(self):
        self.terminal()['data']['currentFrame']+=128
        with self.assertRaises(ValueError): analyze(self.rows,self.controls)
    def test_sequence_and_overflow_refuse(self):
        for mode in ('sequence','overflow'):
            rows=copy.deepcopy(self.rows)
            if mode=='sequence':rows[0]['captured']['events'][2]['sequence']=9
            else:rows[0]['captured']['overflow']=True
            with self.assertRaises(ValueError):analyze(rows,self.controls)
    def test_control_must_retain_original_error(self):
        self.controls[0]['result']['messages'][-1]['reason']='missing-input'
        with self.assertRaises(ValueError):analyze(self.rows,self.controls)
if __name__=='__main__':unittest.main()
