<?php

namespace App\Mail;

use App\Models\License;
use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

class LicenseSold extends Mailable
{
    use Queueable, SerializesModels;

    public function __construct(
        public License $license,
    ) {
        $this->license->loadMissing('work');
    }

    public function envelope(): Envelope
    {
        $work = $this->license->work;

        return new Envelope(
            subject: "Your work sold a {$this->license->tier} license — {$work?->title}",
        );
    }

    public function content(): Content
    {
        return new Content(
            view: 'emails.license-sold',
            with: [
                'license' => $this->license,
                'work' => $this->license->work,
            ],
        );
    }
}
