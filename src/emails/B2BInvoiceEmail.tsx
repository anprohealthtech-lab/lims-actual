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
    Row,
    Column,
} from '@react-email/components';

interface B2BInvoiceEmailProps {
    accountName: string;
    invoiceNumber: string;
    invoiceDate: string;
    dueDate: string;
    amount: string;
    downloadUrl: string;
    labName: string;
    labLogoUrl?: string;
}

export const B2BInvoiceEmail = ({
    accountName = 'Partner Account',
    invoiceNumber = 'INV-001',
    invoiceDate = new Date().toLocaleDateString(),
    dueDate = new Date().toLocaleDateString(),
    amount = '$0.00',
    downloadUrl = '#',
    labName = 'LIMS Lab',
    labLogoUrl,
}: B2BInvoiceEmailProps) => {
    return (
        <Html>
            <Head />
            <Preview>Invoice {invoiceNumber} from {labName}</Preview>
            <Body style={main}>
                <Container style={container}>
                    {labLogoUrl && (
                        <Section style={logoContainer}>
                            <Img src={labLogoUrl} width="150" alt={labName} />
                        </Section>
                    )}
                    <Heading style={h1}>Invoice Ready</Heading>
                    <Text style={text}>Dear {accountName},</Text>
                    <Text style={text}>
                        Your invoice <strong>{invoiceNumber}</strong> generated on {invoiceDate} is now available.
                    </Text>

                    <Section style={statsContainer}>
                        <Row>
                            <Column style={statColumn}>
                                <Text style={statLabel}>Amount Due</Text>
                                <Text style={statValue}>{amount}</Text>
                            </Column>
                            <Column style={statColumn}>
                                <Text style={statLabel}>Due Date</Text>
                                <Text style={statValue}>{dueDate}</Text>
                            </Column>
                        </Row>
                    </Section>

                    <Section style={buttonContainer}>
                        <Button style={button} href={downloadUrl}>
                            View & Pay Invoice
                        </Button>
                    </Section>

                    <Hr style={hr} />
                    <Text style={footer}>
                        {labName}
                    </Text>
                </Container>
            </Body>
        </Html>
    );
};

export default B2BInvoiceEmail;

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

const statsContainer = {
    margin: '20px',
    padding: '20px',
    backgroundColor: '#f9f9f9',
    borderRadius: '4px',
};

const statColumn = {
    textAlign: 'center' as const,
};

const statLabel = {
    color: '#666',
    fontSize: '12px',
    textTransform: 'uppercase' as const,
    letterSpacing: '1px',
    margin: '0',
};

const statValue = {
    color: '#333',
    fontSize: '20px',
    fontWeight: 'bold',
    margin: '5px 0 0',
};

const buttonContainer = {
    textAlign: 'center' as const,
    margin: '30px 0',
};

const button = {
    backgroundColor: '#28a745',
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
