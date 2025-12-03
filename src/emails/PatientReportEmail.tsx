import React from 'react';
import {
    Body,
    Container,
    Head,
    Heading,
    Html,
    Img,
    Link,
    Preview,
    Section,
    Text,
    Button,
    Hr,
} from '@react-email/components';

interface PatientReportEmailProps {
    patientName: string;
    reportDate: string;
    labName: string;
    downloadUrl: string;
    labLogoUrl?: string;
    labAddress?: string;
}

export const PatientReportEmail = ({
    patientName = 'Valued Patient',
    reportDate = new Date().toLocaleDateString(),
    labName = 'LIMS Lab',
    downloadUrl = '#',
    labLogoUrl,
    labAddress,
}: PatientReportEmailProps) => {
    return (
        <Html>
            <Head />
            <Preview>Your medical test report from {labName} is ready</Preview>
            <Body style={main}>
                <Container style={container}>
                    {labLogoUrl && (
                        <Section style={logoContainer}>
                            <Img src={labLogoUrl} width="150" alt={labName} />
                        </Section>
                    )}
                    <Heading style={h1}>Test Report Ready</Heading>
                    <Text style={text}>Dear {patientName},</Text>
                    <Text style={text}>
                        Your test report dated <strong>{reportDate}</strong> is now available.
                        You can download it securely using the button below.
                    </Text>
                    <Section style={buttonContainer}>
                        <Button style={button} href={downloadUrl}>
                            Download Report
                        </Button>
                    </Section>
                    <Text style={text}>
                        If the button doesn't work, you can copy and paste this link into your browser:
                        <br />
                        <Link href={downloadUrl} style={link}>
                            {downloadUrl}
                        </Link>
                    </Text>
                    <Hr style={hr} />
                    <Text style={footer}>
                        {labName}
                        <br />
                        {labAddress}
                    </Text>
                </Container>
            </Body>
        </Html>
    );
};

export default PatientReportEmail;

const main = {
    backgroundColor: '#f6f9fc',
    fontFamily:
        '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Ubuntu,sans-serif',
};

const container = {
    backgroundColor: '#ffffff',
    margin: '0 auto',
    padding: '20px 0 48px',
    marginBottom: '64px',
};

const logoContainer = {
    padding: '20px',
    textAlign: 'center' as const,
};

const h1 = {
    color: '#333',
    fontSize: '24px',
    fontWeight: 'bold',
    textAlign: 'center' as const,
    margin: '30px 0',
};

const text = {
    color: '#333',
    fontSize: '16px',
    lineHeight: '26px',
    textAlign: 'left' as const,
    padding: '0 20px',
};

const buttonContainer = {
    textAlign: 'center' as const,
    margin: '30px 0',
};

const button = {
    backgroundColor: '#007ee6',
    borderRadius: '4px',
    color: '#fff',
    fontSize: '16px',
    textDecoration: 'none',
    textAlign: 'center' as const,
    display: 'block',
    padding: '12px 20px',
    maxWidth: '200px',
    margin: '0 auto',
};

const link = {
    color: '#007ee6',
    textDecoration: 'underline',
};

const hr = {
    borderColor: '#e6ebf1',
    margin: '20px 0',
};

const footer = {
    color: '#8898aa',
    fontSize: '12px',
    lineHeight: '16px',
    textAlign: 'center' as const,
};
