<?php
// POST /api/qr/admin/clock.php — a payment that did not reach Clock PMS+
// (_lib/clock.php), from „За касата“:
//
//   {"id": 5, "action": "retry"}   send it again now, from the step it got to
//   {"id": 5, "action": "closed"}  staff closed its folio in Clock themselves
//                                  (while 'clock_close' is off): off the list
//
// A payment that stopped at 'check' (Clock's answer was lost and it cannot be
// asked whether the step happened) is retried only once a person has looked
// at its folio in Clock: retrying it goes on as if the step had not happened.
// Entering it by hand instead is the tick on „За касата“ (till.php).
//
// ⚠ PHP 7.3 on the production host — see ../_lib/core.php.

declare(strict_types=1);

define('RAYA_QR', true);
require dirname(__DIR__) . '/_lib/core.php';
require dirname(__DIR__) . '/_lib/auth.php';
require dirname(__DIR__) . '/_lib/pay.php';
require dirname(__DIR__) . '/_lib/bill.php';

qr_require_method('POST');
qr_require_admin(true);
$body = qr_body();
$id = $body['id'] ?? null;
$action = $body['action'] ?? '';
if (!is_int($id) || !in_array($action, ['retry', 'closed'], true)) {
    qr_fail(400, 'invalid');
}
$now = qr_now();
list($status, $response) = qr_write(function (PDO $pdo) use ($id, $action, $now) {
    $find = $pdo->prepare('SELECT * FROM clock_docs WHERE id = ?');
    $find->execute([$id]);
    $doc = $find->fetch();
    $find->closeCursor();
    if (!is_array($doc)) {
        return [404, ['ok' => false, 'error' => 'not_found']];
    }
    if ($action === 'closed') {
        if ($doc['status'] !== 'done' || (int) $doc['step'] !== 3) {
            return [409, ['ok' => false, 'error' => 'not_open', 'doc' => qr_clock_doc_json($doc)]];
        }
        $pdo->prepare('UPDATE clock_docs SET step = 4, seq = ? WHERE id = ?')->execute([qr_bump_seq($pdo), $id]);
        $find->execute([$id]);
        $doc = $find->fetch();
        $find->closeCursor();
        return [200, ['ok' => true, 'doc' => qr_clock_doc_json($doc)]];
    }
    if (!in_array($doc['status'], ['failed', 'check'], true)) {
        return [409, ['ok' => false, 'error' => 'not_retryable', 'doc' => qr_clock_doc_json($doc)]];
    }
    // A step whose answer was lost: a person has looked, so it is sent again.
    $pdo->prepare("UPDATE clock_docs SET status = 'pending', tries = 0, next_at = 0, inflight = 0, error = '', seq = ? WHERE id = ?")
        ->execute([qr_bump_seq($pdo), $id]);
    $find->execute([$id]);
    $doc = $find->fetch();
    $find->closeCursor();
    return [200, ['ok' => true, 'doc' => qr_clock_doc_json($doc)]];
});
if ($status === 200 && $action === 'retry') {
    qr_clock_send_later($now);
}
qr_json($status, $response);
