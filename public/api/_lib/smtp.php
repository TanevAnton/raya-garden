<?php
// Minimal authenticated SMTP client — enough to submit one message to a
// transactional relay over an encrypted connection, and no more.
//
// Written rather than vendored: the deploy is an FTP mirror of a static
// build with no Composer step, and a full mail library would be thousands
// of lines shipped for a single sendmail call.
//
// Every failure returns a short reason so the endpoint can log why a send
// failed (and answer the browser honestly) without ever reporting success
// for a message the relay did not accept.

if (!defined('RAYA_ENQUIRY')) {
    http_response_code(404);
    exit;
}

final class SmtpResult
{
    public bool $ok;
    public string $error;
    public string $stage;

    public function __construct(bool $ok, string $stage = '', string $error = '')
    {
        $this->ok = $ok;
        $this->stage = $stage;
        $this->error = $error;
    }
}

final class Smtp
{
    private $socket = null;
    private array $cfg;
    private string $lastReply = '';

    public function __construct(array $cfg)
    {
        $this->cfg = $cfg;
    }

    /**
     * @param string $envelopeFrom  bounce address (authenticated sender)
     * @param string[] $recipients  envelope recipients
     * @param string $message       full RFC 5322 message, CRLF line endings
     */
    public function send(string $envelopeFrom, array $recipients, string $message): SmtpResult
    {
        $host = (string) ($this->cfg['host'] ?? '');
        $port = (int) ($this->cfg['port'] ?? 587);
        $secure = strtolower((string) ($this->cfg['secure'] ?? 'tls')); // tls | ssl | none
        $timeout = (int) ($this->cfg['timeout'] ?? 20);

        if ($host === '') {
            return new SmtpResult(false, 'config', 'SMTP host is not configured');
        }

        $endpoint = ($secure === 'ssl' ? 'ssl://' : 'tcp://') . $host . ':' . $port;
        $context = stream_context_create([
            'ssl' => ['SNI_enabled' => true, 'peer_name' => $host],
        ]);

        $errNo = 0;
        $errStr = '';
        $this->socket = @stream_socket_client(
            $endpoint,
            $errNo,
            $errStr,
            $timeout,
            STREAM_CLIENT_CONNECT,
            $context
        );
        if (!$this->socket) {
            return new SmtpResult(false, 'connect', trim($errStr) !== '' ? $errStr : 'connection failed');
        }
        stream_set_timeout($this->socket, $timeout);

        try {
            if (!$this->expect('220')) {
                return $this->fail('greeting');
            }

            $ehloName = (string) ($this->cfg['ehlo'] ?? 'localhost');
            if (!$this->cmd('EHLO ' . $ehloName, '250')) {
                return $this->fail('ehlo');
            }

            if ($secure === 'tls') {
                if (!$this->cmd('STARTTLS', '220')) {
                    return $this->fail('starttls');
                }
                $crypto = @stream_socket_enable_crypto(
                    $this->socket,
                    true,
                    STREAM_CRYPTO_METHOD_TLS_CLIENT
                );
                if (!$crypto) {
                    return new SmtpResult(false, 'starttls', 'TLS negotiation failed');
                }
                // RFC 3207: re-issue EHLO over the encrypted channel.
                if (!$this->cmd('EHLO ' . $ehloName, '250')) {
                    return $this->fail('ehlo-tls');
                }
            }

            $user = (string) ($this->cfg['username'] ?? '');
            $pass = (string) ($this->cfg['password'] ?? '');
            if ($user !== '') {
                if (!$this->authenticate($user, $pass)) {
                    return $this->fail('auth');
                }
            }

            if (!$this->cmd('MAIL FROM:<' . $envelopeFrom . '>', '250')) {
                return $this->fail('mail-from');
            }
            foreach ($recipients as $rcpt) {
                if (!$this->cmd('RCPT TO:<' . $rcpt . '>', '250')) {
                    return $this->fail('rcpt-to');
                }
            }
            if (!$this->cmd('DATA', '354')) {
                return $this->fail('data');
            }

            $this->write($this->dotStuff($message) . "\r\n.");
            if (!$this->expect('250')) {
                // The relay refused the message body itself — never report success.
                return $this->fail('body');
            }

            $this->cmd('QUIT', '221');
            return new SmtpResult(true, 'sent', '');
        } finally {
            if (is_resource($this->socket)) {
                @fclose($this->socket);
            }
            $this->socket = null;
        }
    }

    private function authenticate(string $user, string $pass): bool
    {
        // AUTH LOGIN is the widest-supported mechanism on shared hosting;
        // PLAIN is the fallback when the server rejects it.
        if ($this->cmd('AUTH LOGIN', '334')) {
            if (!$this->cmd(base64_encode($user), '334')) {
                return false;
            }
            return $this->cmd(base64_encode($pass), '235');
        }
        $plain = base64_encode("\0" . $user . "\0" . $pass);
        return $this->cmd('AUTH PLAIN ' . $plain, '235');
    }

    private function cmd(string $command, string $expectedCode): bool
    {
        $this->write($command);
        return $this->expect($expectedCode);
    }

    private function write(string $line): void
    {
        @fwrite($this->socket, $line . "\r\n");
    }

    /** Reads a (possibly multi-line) reply and checks its status code. */
    private function expect(string $code): bool
    {
        $reply = '';
        while (is_resource($this->socket) && !feof($this->socket)) {
            $line = @fgets($this->socket, 1024);
            if ($line === false) {
                break;
            }
            $reply .= $line;
            // "250-EXTENSION" continues, "250 OK" ends the reply.
            if (strlen($line) >= 4 && $line[3] === ' ') {
                break;
            }
            $meta = stream_get_meta_data($this->socket);
            if (!empty($meta['timed_out'])) {
                break;
            }
        }
        $this->lastReply = trim($reply);
        return strncmp($this->lastReply, $code, strlen($code)) === 0;
    }

    private function fail(string $stage): SmtpResult
    {
        return new SmtpResult(false, $stage, $this->lastReply !== '' ? $this->lastReply : 'no reply');
    }

    /** RFC 5321 §4.5.2 — a line of a single dot would end the DATA block. */
    private function dotStuff(string $message): string
    {
        return preg_replace('/^\./m', '..', $message);
    }
}
